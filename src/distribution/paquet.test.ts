import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  estExclu,
  listerFichiersDuPaquet,
  purgerExclus,
  creerArchive,
  entreesDeLArchive,
  controlerArchive,
  FICHIERS_ENV_PARASITES,
} from '../../outils/lib/paquet.mjs'

let bac = ''

function poser(relatif: string, contenu = 'x'): void {
  const abs = path.join(bac, relatif)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, contenu)
}

beforeEach(() => {
  bac = mkdtempSync(path.join(tmpdir(), 'cra-paquet-'))
})
afterEach(() => {
  rmSync(bac, { recursive: true, force: true })
})

describe("l'archive ne diffuse aucun secret", () => {
  it('exclut le .env que Next recopie dans la sortie standalone', () => {
    // LE piège de ce lot. `next build` recopie le `.env` du dépôt dans
    // `.next/standalone/.env` : mesuré avant ce lot, il portait
    // AUTH_SECRET="dev-secret-non-production", et le `.env` du dépôt porte
    // désormais aussi CREDENTIALS_KEY. Livrer l'archive telle quelle
    // diffuserait donc, à tout le monde et à l'identique, la clé qui déchiffre
    // les jetons Google et la clé d'API Dolibarr de qui l'utilise.
    poser('app/.env', 'AUTH_SECRET="dev-secret-non-production"')
    poser('app/.env.local')
    poser('app/.env.production')
    poser('.env')
    poser('app/server.js')
    expect(listerFichiersDuPaquet(bac)).toEqual(['app/server.js'])
  })

  it('exclut chacun des noms de fichier d environnement déclarés', () => {
    for (const nom of FICHIERS_ENV_PARASITES) {
      expect(estExclu(`app/${nom}`), `app/${nom} doit être exclu`).toBe(true)
    }
  })

  it("n'exclut pas .env.example, qui ne porte aucune valeur", () => {
    // Il documente les variables ; le garde-fou de `src/deploy` vérifie déjà
    // qu'il ne contient aucune valeur exploitable.
    expect(estExclu('.env.example')).toBe(false)
  })
})

describe("l'archive ne contient jamais donnees/", () => {
  it("exclut donnees/ et tout ce qu'il contient", () => {
    // Tant que ce test passe, dézipper la nouvelle version par-dessus
    // l'ancienne ne peut pas écraser la base : il n'y a simplement rien dans
    // l'archive qui puisse la remplacer.
    poser('LISEZMOI.txt')
    poser('demarrer.sh')
    poser('app/server.js')
    poser('donnees/cra.db')
    poser('donnees/cra.db-wal')
    poser('donnees/cra.db-shm')
    poser('donnees/cra.pid')
    poser('donnees/cra.env')
    poser('donnees/journal.log')
    poser('donnees/sauvegardes/sauvegarde-20260816-090000.db')

    const fichiers = listerFichiersDuPaquet(bac)

    expect(fichiers.filter((f) => f.includes('donnees'))).toEqual([])
    expect(fichiers).toEqual(['LISEZMOI.txt', 'app/server.js', 'demarrer.sh'])
  })

  it('exclut un donnees/ imbriqué où qu il soit', () => {
    poser('app/donnees/cra.db')
    poser('app/outils/lancer.mjs')
    expect(listerFichiersDuPaquet(bac)).toEqual(['app/outils/lancer.mjs'])
  })

  it('ne se laisse pas piéger par un nom qui commence pareil', () => {
    // `donneesDeTest.md` n'est pas le dossier de données : l'exclusion doit
    // porter sur un segment de chemin entier, pas sur un préfixe.
    poser('app/donneesDeTest.md')
    expect(listerFichiersDuPaquet(bac)).toEqual(['app/donneesDeTest.md'])
  })
})

describe('autres exclusions', () => {
  it('exclut toute base SQLite trouvée hors de donnees/', () => {
    poser('app/prisma/dev.db')
    poser('app/prisma/dev.db-wal')
    poser('app/prisma/migrations-sqlite/20260816000000_init/migration.sql')
    expect(listerFichiersDuPaquet(bac)).toEqual([
      'app/prisma/migrations-sqlite/20260816000000_init/migration.sql',
    ])
  })

  it('exclut .git et .DS_Store', () => {
    poser('.git/config')
    poser('.DS_Store')
    poser('app/.DS_Store')
    poser('LISEZMOI.txt')
    expect(listerFichiersDuPaquet(bac)).toEqual(['LISEZMOI.txt'])
  })

  it('garde tout le reste, y compris les binaires natifs', () => {
    poser('app/node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node')
    poser('app/node_modules/@node-rs/argon2-darwin-arm64/argon2.darwin-arm64.node')
    const f = listerFichiersDuPaquet(bac)
    expect(f).toHaveLength(2)
    expect(f.some((x) => x.includes('libquery_engine'))).toBe(true)
  })
})

describe('estExclu', () => {
  it('juge sur des segments de chemin, en séparateurs POSIX', () => {
    expect(estExclu('donnees/cra.db')).toBe(true)
    expect(estExclu('app/donnees')).toBe(true)
    expect(estExclu('app/.env')).toBe(true)
    expect(estExclu('app/prisma/dev.db')).toBe(true)
    expect(estExclu('app/server.js')).toBe(false)
    expect(estExclu('LISEZMOI.txt')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Jusqu'ici, tout porte sur le PRÉDICAT. Un prédicat vert n'a jamais empêché
// une archive de partir avec un secret dedans : c'est exactement ce qui s'est
// passé au lot 0, 152 tests au vert et une interface livrée sans style. Ce qui
// suit porte donc sur un `.zip` RÉELLEMENT PRODUIT, relu depuis le fichier,
// puis réellement dézippé.
// ─────────────────────────────────────────────────────────────────────────────

const SECRET_TEMOIN = 'AUTH_SECRET="dev-secret-non-production"'
const DIST_TEMOIN = '.next-dist'

/** Mise en scène minimale, mais complète au sens de `controlerArchive`. */
function mettreEnSceneUnFauxPaquet(paquet: string): void {
  const ecrire = (relatif: string, contenu = 'x'): void => {
    const abs = path.join(paquet, relatif)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, contenu)
  }

  // Ce que l'archive doit porter.
  ecrire('LISEZMOI.txt', 'CRA 1.0.0')
  for (const nom of ['demarrer', 'arreter', 'sauvegarder', 'creer-utilisateur']) {
    ecrire(`${nom}.sh`, '#!/bin/sh\n')
    ecrire(`${nom}.cmd`, '@echo off\r\n')
    ecrire(`app/outils/${nom === 'demarrer' ? 'lancer' : nom}.mjs`)
  }
  ecrire('app/server.js')
  ecrire('app/node_modules/@prisma/client/default.js')
  ecrire('app/node_modules/@node-rs/argon2/index.js')
  ecrire('app/node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node')
  ecrire(`app/${DIST_TEMOIN}/static/css/abc.css`, '.x{color:red}')
  ecrire('app/prisma/migrations-sqlite/20260816000000_init/migration.sql', 'CREATE TABLE "User";')

  // Ce que `next build` et le poste de développement y déposent, et qui ne doit
  // en aucun cas en sortir.
  ecrire('app/.env', SECRET_TEMOIN)
  ecrire('app/.env.production', 'CREDENTIALS_KEY="clef-de-dev"')
  ecrire('donnees/cra.db', 'BASE DE LA PERSONNE')
  ecrire('donnees/cra.db-wal')
  ecrire('donnees/cra.env', 'AUTH_SECRET=celui-de-son-poste')
  ecrire('donnees/journal.log')
  ecrire('donnees/sauvegardes/sauvegarde-20260816-090000.db')
  ecrire('app/donnees/cra.db')
  ecrire('app/prisma/dev.db', 'BASE DE DEV')
  ecrire('.DS_Store')
}

describe("l'archive réellement produite", () => {
  let chantier = ''
  let archive = ''
  let entrees: string[] = []

  beforeEach(() => {
    chantier = mkdtempSync(path.join(tmpdir(), 'cra-zip-'))
    const paquet = path.join(chantier, 'cra')
    mkdirSync(paquet, { recursive: true })
    mettreEnSceneUnFauxPaquet(paquet)

    // La chaîne réelle de `scripts/empaqueter.mjs`, sur les mêmes fonctions.
    purgerExclus(paquet)
    archive = path.join(chantier, 'cra-test.zip')
    creerArchive({ chantier, dossier: 'cra', archive })
    entrees = entreesDeLArchive(archive)
  })

  afterEach(() => {
    rmSync(chantier, { recursive: true, force: true })
  })

  it('ne porte, dans le fichier .zip lui-même, aucune entrée donnees/', () => {
    // LE test du lot, sur l'artefact et non sur la règle. Relu par `unzip`
    // depuis le fichier produit : ce n'est plus la liste qu'on croyait avoir
    // écrite, c'est ce qui partira chez la personne.
    expect(entrees.length).toBeGreaterThan(0)
    expect(entrees.filter((e) => /(^|\/)donnees(\/|$)/.test(e))).toEqual([])
  })

  it('ne porte aucun fichier .env, donc aucun secret de développement', () => {
    expect(entrees.filter((e) => /(^|\/)\.env(\.|$)/.test(e))).toEqual([])
  })

  it('ne laisse le secret témoin nulle part une fois dézippée', () => {
    // Le contrôle des noms d'entrée ne suffirait pas : on dézippe pour de vrai
    // et on relit les octets livrés.
    const extrait = path.join(chantier, 'extrait')
    mkdirSync(extrait, { recursive: true })
    execFileSync('unzip', ['-q', archive, '-d', extrait])

    // Énumération BRUTE, surtout pas `listerFichiersDuPaquet` : celle-ci
    // applique les exclusions et sauterait précisément le fichier qu'on
    // cherche. Le test ne prouverait alors plus rien — vérifié en rendant
    // `purgerExclus` inerte, où il restait vert.
    const tous: string[] = []
    const descendre = (abs: string, prefixe: string): void => {
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        const relatif = prefixe === '' ? e.name : `${prefixe}/${e.name}`
        if (e.isDirectory()) descendre(path.join(abs, e.name), relatif)
        else tous.push(relatif)
      }
    }
    descendre(extrait, '')

    expect(tous.length).toBeGreaterThan(0)
    for (const f of tous) {
      const contenu = readFileSync(path.join(extrait, f), 'utf8')
      expect(contenu, `${f} contient le secret témoin`).not.toContain('dev-secret-non-production')
    }
  })

  it("dézippée par-dessus une installation, ne touche pas à la base", () => {
    // La promesse du LISEZMOI, éprouvée sur le vrai `.zip` : l'archive n'a
    // rien à mettre à la place de `donnees/cra.db`.
    const installation = path.join(chantier, 'installation')
    mkdirSync(path.join(installation, 'cra', 'donnees', 'sauvegardes'), { recursive: true })
    const base = path.join(installation, 'cra', 'donnees', 'cra.db')
    writeFileSync(base, 'SIX MOIS DE CRA')

    execFileSync('unzip', ['-o', '-q', archive, '-d', installation])

    expect(readFileSync(base, 'utf8')).toBe('SIX MOIS DE CRA')
  })

  it("porte tout ce sans quoi elle ne démarrerait pas", () => {
    const { interdits, manquants } = controlerArchive(entrees, { dist: DIST_TEMOIN })
    expect(interdits).toEqual([])
    expect(manquants).toEqual([])
  })

  it("l'auto-contrôle refuserait une archive assemblée sans la purge", () => {
    // Sans ce test, `controlerArchive` pourrait ne rien détecter du tout et
    // l'empaquetage se croirait sûr. On lui montre donc une archive fautive.
    const fautif = mkdtempSync(path.join(tmpdir(), 'cra-zip-fautif-'))
    try {
      const paquet = path.join(fautif, 'cra')
      mkdirSync(paquet, { recursive: true })
      mettreEnSceneUnFauxPaquet(paquet) // aucune purge, cette fois
      const sale = path.join(fautif, 'sale.zip')
      creerArchive({ chantier: fautif, dossier: 'cra', archive: sale })

      const { interdits } = controlerArchive(entreesDeLArchive(sale), { dist: DIST_TEMOIN })
      expect(interdits).toContain('cra/donnees/cra.db')
      expect(interdits).toContain('cra/app/.env')
    } finally {
      rmSync(fautif, { recursive: true, force: true })
    }
  })

  it("l'auto-contrôle nomme ce qui manque", () => {
    const { manquants } = controlerArchive(
      entrees.filter((e) => !e.startsWith('cra/app/node_modules/.prisma/')),
      { dist: DIST_TEMOIN },
    )
    expect(manquants.join('\n')).toContain('le moteur Prisma natif')
  })
})
