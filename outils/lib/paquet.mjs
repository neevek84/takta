import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

/**
 * Fichiers d'environnement qui n'ont rien à faire dans l'archive.
 *
 * `next build` recopie le `.env` du dépôt dans sa sortie `standalone` : mesuré
 * avant ce lot, `.next/standalone/.env` portait
 * `AUTH_SECRET="dev-secret-non-production"`, et le `.env` du dépôt porte
 * désormais aussi `CREDENTIALS_KEY`. Livrer l'archive telle quelle diffuserait
 * donc à tout le monde, à l'identique, la clé qui déchiffre les jetons Google
 * et la clé d'API Dolibarr de qui l'installe.
 *
 * Cette liste est partagée avec `outils/lancer.mjs`, qui la rejoue au
 * démarrage sur `app/` — seconde ligne pour une archive plus ancienne ou
 * assemblée à la main. Dans la mise en page portable, la configuration vit
 * dans `donnees/cra.env` et nulle part ailleurs : rien ici n'est une perte.
 *
 * `.env.example` n'y figure pas : il ne porte aucune valeur, et
 * `src/deploy/deployment-config.test.ts` s'en assure.
 */
export const FICHIERS_ENV_PARASITES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
  '.env.development',
  '.env.development.local',
]

/** Dossiers exclus quel que soit leur emplacement, comparés segment entier. */
const DOSSIERS_EXCLUS = new Set(['donnees', '.git'])

/** Fichiers exclus quel que soit leur emplacement. */
const FICHIERS_EXCLUS = new Set(['.DS_Store', 'Thumbs.db', ...FICHIERS_ENV_PARASITES])

/**
 * Bases SQLite égarées hors de `donnees/` : `prisma/dev.db` et ses compagnons
 * `-wal`, `-shm`, `-journal`. Une base de développement livrée dans l'archive
 * exposerait les données de qui l'a construite.
 */
const BASE_SQLITE_RE = /\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/

/**
 * Vrai si ce chemin relatif (séparateurs POSIX) ne doit pas entrer dans
 * l'archive. Le jugement porte sur des **segments entiers** : `donneesDeTest.md`
 * n'est pas `donnees/`.
 */
export function estExclu(cheminRelatif) {
  const segments = cheminRelatif.split('/').filter((s) => s !== '')
  if (segments.length === 0) return false

  for (const segment of segments) {
    if (DOSSIERS_EXCLUS.has(segment)) return true
    if (FICHIERS_EXCLUS.has(segment)) return true
  }

  const dernier = segments[segments.length - 1]
  if (BASE_SQLITE_RE.test(dernier)) return true

  return false
}

/**
 * Fichiers à empaqueter depuis `racine` : chemins relatifs POSIX, triés.
 * Un dossier exclu n'est pas parcouru — inutile de descendre dans `donnees/`.
 */
export function listerFichiersDuPaquet(racine) {
  const out = []

  const descendre = (absolu, prefixe) => {
    for (const entree of readdirSync(absolu, { withFileTypes: true })) {
      const relatif = prefixe === '' ? entree.name : `${prefixe}/${entree.name}`
      if (estExclu(relatif)) continue
      if (entree.isDirectory()) descendre(path.join(absolu, entree.name), relatif)
      else out.push(relatif)
    }
  }

  descendre(racine, '')
  return out.sort()
}

/**
 * Retire du chantier tout ce que les règles excluent, **avant** la création de
 * l'archive.
 *
 * Le prédicat `estExclu` seul ne prouve rien sur ce qui est livré : c'est cette
 * fonction, puis `entreesDeLArchive`, qui font le lien entre la règle et le
 * fichier `.zip` réel. Un dossier exclu part d'un bloc, sans être parcouru.
 *
 * @param {string} racine dossier mis en scène (celui qui deviendra l'archive)
 * @returns {number} nombre d'entrées retirées
 */
export function purgerExclus(racine) {
  let purges = 0

  const descendre = (absolu, prefixe) => {
    for (const entree of readdirSync(absolu, { withFileTypes: true })) {
      const relatif = prefixe === '' ? entree.name : `${prefixe}/${entree.name}`
      const cible = path.join(absolu, entree.name)
      if (estExclu(relatif)) {
        rmSync(cible, { recursive: true, force: true })
        purges++
        continue
      }
      if (entree.isDirectory()) descendre(cible, relatif)
    }
  }

  descendre(racine, '')
  return purges
}

/**
 * Crée l'archive `.zip` de `dossier`, depuis `chantier`.
 *
 * `-X` retire les attributs étendus — dont la quarantaine macOS, qui suivrait
 * sinon les fichiers jusque chez la personne qui dézippe.
 *
 * @param {{ chantier: string, dossier: string, archive: string }} options
 */
export function creerArchive({ chantier, dossier, archive }) {
  rmSync(archive, { force: true })
  if (process.platform === 'win32') {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${path.join(chantier, dossier)}' -DestinationPath '${archive}'`,
      ],
      { stdio: 'inherit' },
    )
  } else {
    execFileSync('zip', ['-q', '-r', '-X', archive, dossier], { cwd: chantier, stdio: 'inherit' })
  }
}

/**
 * Entrées réellement présentes dans une archive, relues **depuis le fichier
 * produit** — jamais depuis la liste qu'on croyait y avoir mis.
 *
 * @param {string} archive
 * @returns {string[]} chemins POSIX, dossiers compris
 */
export function entreesDeLArchive(archive) {
  const brut =
    process.platform === 'win32'
      ? execFileSync('powershell', [
          '-NoProfile',
          '-Command',
          'Add-Type -A System.IO.Compression.FileSystem; ' +
            `[IO.Compression.ZipFile]::OpenRead('${archive}').Entries | ForEach-Object { $_.FullName }`,
        ])
      : execFileSync('unzip', ['-Z1', archive])

  return brut
    .toString()
    .split(/\r?\n/)
    .map((e) => e.trim().replace(/\\/g, '/'))
    .filter(Boolean)
}

/** Ce dont l'absence rendrait l'archive inutilisable, chemin exact. */
export const ENTREES_ATTENDUES = [
  'cra/LISEZMOI.txt',
  'cra/demarrer.sh',
  'cra/arreter.sh',
  'cra/sauvegarder.sh',
  'cra/creer-utilisateur.sh',
  'cra/demarrer.cmd',
  'cra/arreter.cmd',
  'cra/sauvegarder.cmd',
  'cra/creer-utilisateur.cmd',
  'cra/app/server.js',
  'cra/app/outils/lancer.mjs',
  'cra/app/outils/arreter.mjs',
  'cra/app/outils/sauvegarder.mjs',
  'cra/app/outils/creer-utilisateur.mjs',
]

/** Ce dont l'absence rendrait l'archive inutilisable, par préfixe de chemin. */
export function prefixesAttendus(dist) {
  return [
    ['cra/app/node_modules/@prisma/client/', 'le client Prisma'],
    ['cra/app/node_modules/@node-rs/argon2', 'argon2 (creation d utilisateur)'],
    ['cra/app/node_modules/.prisma/client/', 'le moteur Prisma natif'],
    [`cra/app/${dist}/static/`, 'les fichiers statiques (CSS compris)'],
    ['cra/app/prisma/migrations-sqlite/', 'les migrations SQLite'],
  ]
}

/**
 * Auto-contrôle de l'archive produite, sur ses entrées relues.
 *
 * Deux questions, dans cet ordre d'importance :
 *
 *  1. **Y a-t-il une entrée interdite ?** `donnees/` rendrait l'écrasement
 *     accidentel possible ; un `.env` diffuserait `AUTH_SECRET` et la
 *     `CREDENTIALS_KEY` qui déchiffre les jetons externes de qui construit.
 *  2. **Manque-t-il quelque chose d'indispensable ?** Une archive amputée du
 *     moteur natif ou des fichiers statiques démarre puis échoue chez la
 *     personne, loin d'ici.
 *
 * @param {string[]} entrees
 * @param {{ dist: string }} options
 * @returns {{ interdits: string[], manquants: string[] }}
 */
export function controlerArchive(entrees, { dist }) {
  const interdits = entrees.filter(
    (e) => /(^|\/)donnees(\/|$)/.test(e) || /(^|\/)\.env(\.|$)/.test(e),
  )

  const manquants = ENTREES_ATTENDUES.filter((a) => !entrees.includes(a))
  for (const [prefixe, quoi] of prefixesAttendus(dist)) {
    if (!entrees.some((e) => e.startsWith(prefixe))) manquants.push(`${prefixe} (${quoi})`)
  }

  return { interdits, manquants }
}
