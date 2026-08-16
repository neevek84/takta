import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  estExclu,
  listerFichiersDuPaquet,
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
