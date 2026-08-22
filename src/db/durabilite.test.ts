import { describe, it, expect, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { prisma, assurerDurabilite } from '@/db/client'
import { urlSqliteDurable, estSqlite, poserDurabiliteSqlite } from '@/db/durabilite'

/**
 * Le LISEZMOI promet : « Fermer la fenetre, arreter le programme ou couper
 * l'ordinateur ne fait perdre aucune saisie deja enregistree. »
 *
 * WAL couvre l'arrêt du processus. La coupure de courant exige en plus
 * `synchronous=FULL`, qui est une propriété **de connexion** : posée par le
 * lanceur, elle mourait avec sa connexion, et le serveur — un autre processus —
 * n'en posait aucune. Ces tests portent sur l'endroit où le serveur l'applique
 * réellement.
 */

let bac = ''
const clients: PrismaClient[] = []

afterEach(async () => {
  for (const c of clients.splice(0)) await c.$disconnect()
  if (bac !== '') rmSync(bac, { recursive: true, force: true })
  bac = ''
})

function ouvrir(url: string): PrismaClient {
  const c = new PrismaClient({ datasources: { db: { url } } })
  clients.push(c)
  return c
}

function fichierNeuf(): string {
  bac = mkdtempSync(path.join(tmpdir(), 'cra-dur-'))
  return path.join(bac, 'cra.db')
}

async function lireSynchronous(client: PrismaClient): Promise<number> {
  const r = await client.$queryRawUnsafe<{ synchronous: bigint | number }[]>('PRAGMA synchronous')
  return Number(r[0]!.synchronous)
}

/** Toutes les valeurs vues en interrogeant le pool en parallèle, dédoublonnées. */
async function valeursDuPool(client: PrismaClient): Promise<number[]> {
  const vues = await Promise.all(Array.from({ length: 32 }, () => lireSynchronous(client)))
  return [...new Set(vues)].sort()
}

describe('urlSqliteDurable', () => {
  it('impose une connexion unique à SQLite', () => {
    // Mesuré : le pool SQLite de Prisma ouvre plusieurs connexions, et
    // `PRAGMA synchronous` ne vaut que pour celle qui l'a reçu. Même posé
    // soixante-quatre fois en parallèle, il en laissait à la valeur par
    // défaut. Une seule connexion est la seule façon honnête de tenir la
    // promesse — et c'est sans coût pour une application de bureau à un seul
    // utilisateur, SQLite ne sachant de toute façon écrire que l'un après
    // l'autre.
    expect(urlSqliteDurable('file:/donnees/cra.db')).toBe(
      'file:/donnees/cra.db?connection_limit=1',
    )
  })

  it('ne double jamais un réglage déjà posé', () => {
    const u = 'file:/donnees/cra.db?connection_limit=1'
    expect(urlSqliteDurable(u)).toBe(u)
    expect(urlSqliteDurable('file:/d/cra.db?socket_timeout=5')).toBe(
      'file:/d/cra.db?socket_timeout=5&connection_limit=1',
    )
  })

  it('laisse PostgreSQL intact : la promesse portable ne le concerne pas', () => {
    const u = 'postgresql://cra:motdepasse@db:5432/cra'
    expect(estSqlite(u)).toBe(false)
    expect(urlSqliteDurable(u)).toBe(u)
  })

  it('supporte un chemin comportant des espaces', () => {
    // Cas très ordinaire sur un poste personnel : « Mon Dossier/cra ».
    expect(urlSqliteDurable('file:/Users/moi/Mon Dossier/cra/donnees/cra.db')).toBe(
      'file:/Users/moi/Mon Dossier/cra/donnees/cra.db?connection_limit=1',
    )
  })
})

describe('poserDurabiliteSqlite', () => {
  it('pose synchronous=FULL là où il ne valait pas FULL', async () => {
    // Le test qui se contentait de lire le pragma après les migrations ne
    // mesurait que la valeur par défaut compilée de SQLite : il restait vert
    // quand on supprimait purement et simplement la ligne. Ici on part d'une
    // connexion où le pragma vaut OFF, donc seule sa pose peut le ramener à 2.
    const client = ouvrir(urlSqliteDurable(`file:${fichierNeuf()}`))
    await client.$executeRawUnsafe('PRAGMA synchronous=OFF')
    expect(await lireSynchronous(client)).toBe(0)

    await poserDurabiliteSqlite(client, 'file:x.db')

    expect(await lireSynchronous(client)).toBe(2)
  })

  it('couvre TOUTES les connexions du pool, pas seulement celle qui a reçu le pragma', async () => {
    const client = ouvrir(urlSqliteDurable(`file:${fichierNeuf()}`))
    await client.$executeRawUnsafe('PRAGMA synchronous=OFF')
    expect(await valeursDuPool(client)).toEqual([0])

    await poserDurabiliteSqlite(client, 'file:x.db')

    expect(await valeursDuPool(client)).toEqual([2])
  })

  it('pose aussi la journalisation WAL, propriété persistante du fichier', async () => {
    const fichier = fichierNeuf()
    const client = ouvrir(urlSqliteDurable(`file:${fichier}`))
    await poserDurabiliteSqlite(client, 'file:x.db')
    await client.$disconnect()

    const relecture = ouvrir(urlSqliteDurable(`file:${fichier}`))
    const mode = await relecture.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode')
    expect(mode[0]!.journal_mode.toLowerCase()).toBe('wal')
  })

  it('replie le journal souvent, au lieu d attendre quatre mégaoctets', async () => {
    // Le `-wal` est le seul exemplaire de ce qu'il porte tant qu'il n'est pas
    // replié. Au seuil par défaut — mille pages —, cette application met des
    // semaines à l'atteindre : le journal a donc porté des heures de saisie,
    // seul. Perdu, la base principale reste valide, et périmée d'autant.
    const fichier = fichierNeuf()
    const client = ouvrir(urlSqliteDurable(`file:${fichier}`))
    await poserDurabiliteSqlite(client, 'file:x.db')

    const seuil = await client.$queryRawUnsafe<{ wal_autocheckpoint: number }[]>(
      'PRAGMA wal_autocheckpoint',
    )
    expect(Number(seuil[0]!.wal_autocheckpoint)).toBe(100)
    await client.$disconnect()
  })

  it('refuse de laisser croire à la durabilité si le pragma n a pas pris', async () => {
    // Un SQLite compilé avec SQLITE_DEFAULT_WAL_SYNCHRONOUS=1, ou un système de
    // fichiers qui refuse WAL : mieux vaut une panne bruyante au démarrage
    // qu'une promesse fausse dans le mode d'emploi.
    const faux = {
      $queryRawUnsafe: async (sql: string) =>
        /journal_mode/.test(sql) ? [{ journal_mode: 'wal' }] : [{ synchronous: 1 }],
      $executeRawUnsafe: async () => 0,
    }
    await expect(poserDurabiliteSqlite(faux as never, 'file:x.db')).rejects.toThrow(/synchronous/i)
  })

  it('ne touche à rien quand la base n est pas SQLite', async () => {
    const faux = {
      $queryRawUnsafe: async () => {
        throw new Error('aucune requête ne doit partir')
      },
      $executeRawUnsafe: async () => {
        throw new Error('aucune requête ne doit partir')
      },
    }
    await expect(
      poserDurabiliteSqlite(faux as never, 'postgresql://cra@db:5432/cra'),
    ).resolves.toBeUndefined()
  })
})

describe("le client de l'application", () => {
  it('applique réellement la durabilité, sur une connexion unique', async () => {
    // C'est le cœur du défaut : le lanceur posait le pragma sur SA connexion,
    // refermée avant même le `spawn`. Le serveur est un autre processus ; il
    // doit le poser sur la sienne, et c'est ce client-ci qu'il utilise.
    await assurerDurabilite()
    if (!estSqlite(process.env.DATABASE_URL ?? '')) return

    await prisma.$executeRawUnsafe('PRAGMA synchronous=OFF')
    expect(
      await valeursDuPool(prisma as unknown as PrismaClient),
      "le client de l'application ouvre plusieurs connexions : le pragma n'en couvrirait qu'une",
    ).toEqual([0])

    await poserDurabiliteSqlite(prisma, process.env.DATABASE_URL!)

    expect(await valeursDuPool(prisma as unknown as PrismaClient)).toEqual([2])
  })
})
