/**
 * Produit l'archive portable d'une plateforme : `distribution/cra-<version>-<plateforme>.zip`.
 *
 * Trois précautions structurent ce script :
 *
 *  1. **Il construit dans un `distDir` à part** (`CRA_DIST_DIR`, `.next-dist`
 *     par défaut) : construire dans `.next` écraserait le cache du serveur de
 *     développement — piège nommé dans `docs/superpowers/ETAT.md` §7.
 *  2. **Il ne modifie jamais `prisma/schema.prisma`.** Le mode portable exige
 *     le provider SQLite ; plutôt que de réécrire un fichier versionné (que
 *     d'autres chantiers ont peut-être en cours), il dérive une copie
 *     temporaire `prisma/.schema-portable.prisma` et la donne à
 *     `prisma generate --schema`.
 *  3. **Il rouvre l'archive qu'il vient d'écrire** et refuse de rendre la main
 *     si elle porte `donnees/` ou un `.env`. C'est la propriété de sécurité du
 *     lot : sans `donnees/` dans l'archive, dézipper par-dessus une
 *     installation existante ne peut pas écraser la base.
 */
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  purgerExclus,
  creerArchive,
  entreesDeLArchive,
  controlerArchive,
} from '../outils/lib/paquet.mjs'
import { texteLisezmoi } from '../outils/lib/lisezmoi.mjs'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = process.env.CRA_DIST_DIR ?? '.next-dist'
const SORTIE = path.join(RACINE, 'distribution')
const CHANTIER = path.join(SORTIE, 'build')
const PAQUET = path.join(CHANTIER, 'cra')
const SCHEMA_PORTABLE = path.join(RACINE, 'prisma/.schema-portable.prisma')

const version = JSON.parse(readFileSync(path.join(RACINE, 'package.json'), 'utf8')).version

/**
 * Plateforme visée et jeton attendu dans le nom du moteur Prisma. Les moteurs
 * sont compilés par architecture : il n'existe pas d'archive universelle, et
 * livrer le mauvais moteur ne se verrait qu'au premier démarrage, chez l'autre.
 */
const PLATEFORMES = {
  'darwin-arm64': {
    nom: 'macos-apple-silicon',
    libelle: 'macOS Apple Silicon',
    jeton: /darwin-arm64/,
  },
  'darwin-x64': { nom: 'macos-intel', libelle: 'macOS Intel', jeton: /darwin(?!-arm64)/ },
  'win32-x64': { nom: 'windows-x64', libelle: 'Windows x64', jeton: /windows/ },
  'linux-x64': { nom: 'linux-x64', libelle: 'Linux x64', jeton: /linux|debian|rhel|musl/ },
}

// `npx` est un .cmd sous Windows : sans `shell`, execFileSync ne le trouve pas.
const SHELL = { shell: process.platform === 'win32' }

function etape(titre) {
  console.log(`\n== ${titre}`)
}

function echoue(message) {
  rmSync(SCHEMA_PORTABLE, { force: true })
  console.error(`\nEMPAQUETAGE INTERROMPU\n${message}\n`)
  process.exit(1)
}

// ── 1. Plateforme ────────────────────────────────────────────────────────────
const cle = `${process.platform}-${process.arch}`
const cible = PLATEFORMES[cle]
if (!cible) {
  echoue(
    `Plateforme non prevue : ${cle}.\n` +
      `Les archives sont produites une par plateforme : ${Object.keys(PLATEFORMES).join(', ')}.`,
  )
}
console.log(`Cible : ${cible.libelle} (${cle}), version ${version}`)

// ── 2. Client Prisma SQLite, sans toucher au schema versionne ────────────────
etape('Generation du client Prisma sur un schema SQLite derive')
const schema = readFileSync(path.join(RACINE, 'prisma/schema.prisma'), 'utf8')
const schemaSqlite = schema.replace(/provider = "postgresql"/, 'provider = "sqlite"')
if (!schemaSqlite.includes('provider = "sqlite"')) {
  echoue(
    "Le bloc datasource de prisma/schema.prisma n'a pas pu etre bascule en sqlite.\n" +
      "Le mode portable ne fonctionne qu'avec SQLite.",
  )
}
writeFileSync(
  SCHEMA_PORTABLE,
  '// Fichier TEMPORAIRE, engendre par scripts/empaqueter.mjs, jamais commite.\n' +
    "// Il existe pour ne pas reecrire prisma/schema.prisma pendant l'empaquetage.\n" +
    schemaSqlite,
)
execFileSync('npx', ['prisma', 'generate', '--schema', SCHEMA_PORTABLE], {
  cwd: RACINE,
  stdio: 'inherit',
  ...SHELL,
})

// ── 3. Construction, dans un distDir a part ──────────────────────────────────
// `next build` reecrit `tsconfig.json` et `next-env.d.ts` pour y declarer
// `<distDir>/types`. Avec un distDir inhabituel, cela salirait deux fichiers
// versionnes : on les remet dans l'etat ou on les a trouves.
etape(`Construction Next dans ${DIST}`)
const APRES_BUILD = ['tsconfig.json', 'next-env.d.ts']
const avant = new Map(
  APRES_BUILD.filter((f) => existsSync(path.join(RACINE, f))).map((f) => [
    f,
    readFileSync(path.join(RACINE, f), 'utf8'),
  ]),
)

rmSync(path.join(RACINE, DIST), { recursive: true, force: true })
try {
  execFileSync('npx', ['next', 'build'], {
    cwd: RACINE,
    stdio: 'inherit',
    ...SHELL,
    env: { ...process.env, CRA_DIST_DIR: DIST, NODE_ENV: 'production' },
  })
} finally {
  for (const [f, contenu] of avant) {
    if (readFileSync(path.join(RACINE, f), 'utf8') !== contenu) {
      writeFileSync(path.join(RACINE, f), contenu)
      console.log(`${f} remis dans son etat d'origine (next build l'avait reecrit).`)
    }
  }
}

const standalone = path.join(RACINE, DIST, 'standalone')
if (!existsSync(path.join(standalone, 'server.js'))) {
  echoue(
    `${path.join(standalone, 'server.js')} est absent.\n` +
      "La sortie standalone n'a pas ete produite dans le distDir attendu.\n" +
      "Verifie que next.config.ts porte bien `output: 'standalone'` et\n" +
      '`distDir: process.env.CRA_DIST_DIR ?? ".next"`.',
  )
}

// ── 4. Le moteur Prisma correspond-il bien a cette plateforme ? ───────────────
etape('Controle du moteur Prisma embarque')
const dossierMoteur = path.join(standalone, 'node_modules/.prisma/client')
const moteurs = existsSync(dossierMoteur)
  ? readdirSync(dossierMoteur).filter((f) => f.includes('query_engine') && f.endsWith('.node'))
  : []
if (moteurs.length === 0) {
  echoue(
    `Aucun moteur Prisma dans ${dossierMoteur}.\n` +
      "L'archive ne demarrerait pas : `prisma generate` n'a pas produit de moteur natif.",
  )
}
if (!moteurs.some((m) => cible.jeton.test(m))) {
  echoue(
    `Le moteur present (${moteurs.join(', ')}) ne correspond pas a ${cible.libelle}.\n` +
      "Les moteurs Prisma sont compiles par architecture : il n'existe pas d'archive universelle.\n" +
      "Construis l'archive de cette plateforme SUR cette plateforme.",
  )
}
console.log(`Moteur : ${moteurs.join(', ')}`)

// ── 5. Mise en scene ─────────────────────────────────────────────────────────
etape("Mise en scene de l'archive")
rmSync(CHANTIER, { recursive: true, force: true })
mkdirSync(PAQUET, { recursive: true })

cpSync(standalone, path.join(PAQUET, 'app'), { recursive: true })
cpSync(path.join(RACINE, DIST, 'static'), path.join(PAQUET, 'app', DIST, 'static'), {
  recursive: true,
})
if (existsSync(path.join(RACINE, 'public'))) {
  cpSync(path.join(RACINE, 'public'), path.join(PAQUET, 'app', 'public'), { recursive: true })
}
cpSync(path.join(RACINE, 'outils'), path.join(PAQUET, 'app', 'outils'), { recursive: true })
cpSync(
  path.join(RACINE, 'prisma/migrations-sqlite'),
  path.join(PAQUET, 'app/prisma/migrations-sqlite'),
  { recursive: true },
)

for (const f of readdirSync(SORTIE)) {
  if (f.endsWith('.sh') || f.endsWith('.cmd')) {
    cpSync(path.join(SORTIE, f), path.join(PAQUET, f))
    if (f.endsWith('.sh')) chmodSync(path.join(PAQUET, f), 0o755)
  }
}

writeFileSync(path.join(PAQUET, 'LISEZMOI.txt'), texteLisezmoi({ plateforme: cible.libelle, version }))

// ── 6. Purge : tout ce que les regles excluent quitte le chantier ────────────
etape('Purge des fichiers exclus')
const purges = purgerExclus(PAQUET)
console.log(
  `${purges} entree(s) purgee(s) — dont le .env recopie par Next dans la sortie standalone.`,
)

// ── 7. Archive ───────────────────────────────────────────────────────────────
etape("Creation de l'archive")
const nomArchive = `cra-${version}-${cible.nom}.zip`
const archive = path.join(SORTIE, nomArchive)
creerArchive({ chantier: CHANTIER, dossier: 'cra', archive })

// ── 8. Auto-controle de l'archive produite ───────────────────────────────────
etape('Auto-controle')
const entrees = entreesDeLArchive(archive)
const { interdits, manquants } = controlerArchive(entrees, { dist: DIST })

if (interdits.length > 0) {
  echoue(
    "L'archive contient des entrees interdites :\n  " +
      interdits.join('\n  ') +
      "\n\nC'est la propriete de securite du lot : sans donnees/ dans l'archive, dezipper\n" +
      "par dessus une installation existante ne peut pas ecraser la base.",
  )
}
if (manquants.length > 0) {
  echoue("L'archive est incomplete, il manque :\n  " + manquants.join('\n  '))
}

rmSync(SCHEMA_PORTABLE, { force: true })

console.log('')
console.log(`Archive : ${archive}`)
console.log(`Entrees : ${entrees.length}`)
console.log("Aucune entree donnees/, aucun .env : dezipper par dessus n'ecrase aucune base.")
console.log('')
