import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  decouperSql,
  migrationsDisponibles,
  appliquerMigrations,
  urlBaseDurable,
} from '../../outils/lib/migrations.mjs'
import { sauvegarderBase, horodatage } from '../../outils/lib/sauvegarde.mjs'
import { urlSqliteDurable } from '@/db/durabilite'

const RACINE_DEPOT = path.resolve(__dirname, '../..')
const JEU_REEL = path.join(RACINE_DEPOT, 'prisma/migrations-sqlite')

let bac = ''
let clients: PrismaClient[] = []

/**
 * Ouvre un client Prisma sur un fichier SQLite précis, hors de la base de
 * développement — avec l'URL du lanceur, connexion unique comprise : c'est ce
 * qui rend `PRAGMA synchronous` observable, donc testable.
 */
function ouvrir(fichier: string): PrismaClient {
  const c = new PrismaClient({ datasources: { db: { url: urlBaseDurable(fichier) } } })
  clients.push(c)
  return c
}

beforeEach(() => {
  bac = mkdtempSync(path.join(tmpdir(), 'cra-mig-'))
  clients = []
})

afterEach(async () => {
  for (const c of clients) await c.$disconnect()
  rmSync(bac, { recursive: true, force: true })
})

/** Fabrique un jeu de migrations jouet dans le bac à sable. */
function jeuJouet(): string {
  const dir = path.join(bac, 'migrations')
  mkdirSync(path.join(dir, '20260101000000_init'), { recursive: true })
  writeFileSync(
    path.join(dir, '20260101000000_init/migration.sql'),
    '-- CreateTable\nCREATE TABLE "Note" (\n  "id" TEXT NOT NULL PRIMARY KEY,\n  "titre" TEXT NOT NULL\n);\n',
  )
  return dir
}

function ajouterSeconde(dir: string): void {
  mkdirSync(path.join(dir, '20260202000000_couleur'), { recursive: true })
  writeFileSync(
    path.join(dir, '20260202000000_couleur/migration.sql'),
    '-- AlterTable\nALTER TABLE "Note" ADD COLUMN "couleur" TEXT;\n',
  )
}

describe('decouperSql', () => {
  it('sépare les instructions et retire les commentaires', () => {
    const out = decouperSql(
      '-- un commentaire\nCREATE TABLE "A" ("x" TEXT);\n-- autre\nDROP TABLE "A";\n',
    )
    expect(out).toEqual(['CREATE TABLE "A" ("x" TEXT)', 'DROP TABLE "A"'])
  })

  it('ne rend aucune instruction vide', () => {
    expect(decouperSql(';;\n-- rien\n\n;')).toEqual([])
  })
})

describe('migrationsDisponibles', () => {
  it('trie par nom, donc chronologiquement', () => {
    const dir = jeuJouet()
    ajouterSeconde(dir)
    expect(migrationsDisponibles(dir)).toEqual(['20260101000000_init', '20260202000000_couleur'])
  })
})

describe('appliquerMigrations', () => {
  it('crée la base et applique tout depuis vide', async () => {
    const fichier = path.join(bac, 'cra.db')
    const prisma = ouvrir(fichier)
    const r = await appliquerMigrations({ prisma, dossier: jeuJouet() })

    expect(r.appliquees).toEqual(['20260101000000_init'])
    expect(r.sauvegarde).toBeNull()
    const noms = await prisma.$queryRawUnsafe<{ nom: string }[]>(
      'SELECT nom FROM "_cra_migrations"',
    )
    expect(noms.map((n) => n.nom)).toEqual(['20260101000000_init'])
  })

  it('met la base en journalisation WAL, et le prouve en relisant le pragma', async () => {
    // C'est la propriété qui autorise la phrase du LISEZMOI : arrêter ne perd
    // rien. Prisma laisse SQLite en mode `delete` par défaut — mesuré sur
    // prisma/dev.db avant ce lot. Sans cette ligne, la promesse serait fausse.
    //
    // La relecture se fait ici sur une connexion NEUVE : le mode de
    // journalisation est une propriété persistante du fichier, pas de la
    // session. Le lire sur la connexion qui vient de le poser ne prouverait
    // que l'aller-retour d'une commande.
    const fichier = path.join(bac, 'cra.db')
    const prisma = ouvrir(fichier)
    await appliquerMigrations({ prisma, dossier: jeuJouet() })
    await prisma.$disconnect()

    const relecture = ouvrir(fichier)
    const mode = await relecture.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode')
    expect(mode[0]!.journal_mode.toLowerCase()).toBe('wal')
  })

  it("attend la confirmation du disque à chaque transaction (synchronous=FULL)", async () => {
    // WAL seul ne couvre que l'arrêt du processus. La promesse porte aussi sur
    // « couper l'ordinateur » : avec synchronous=NORMAL, SQLite n'attend plus
    // le disque et une coupure de courant peut perdre les dernières
    // transactions. 2 = FULL.
    //
    // La connexion part de OFF : lire le pragma sans cela ne mesurait que la
    // valeur par défaut compilée de SQLite, et le test restait vert quand on
    // supprimait purement et simplement la ligne qu'il prétendait garder.
    const prisma = ouvrir(path.join(bac, 'cra.db'))
    await prisma.$executeRawUnsafe('PRAGMA synchronous=OFF')

    await appliquerMigrations({ prisma, dossier: jeuJouet() })

    const s = await prisma.$queryRawUnsafe<{ synchronous: bigint | number }[]>(
      'PRAGMA synchronous',
    )
    expect(Number(s[0]!.synchronous)).toBe(2)
  })

  it("refuse de démarrer si SQLite n'a pas retenu synchronous=FULL", async () => {
    // Une construction de SQLite avec SQLITE_DEFAULT_WAL_SYNCHRONOUS=1 ramène
    // le pragma à NORMAL sans rien dire. La promesse « couper l'ordinateur ne
    // perd rien » tomberait alors en silence : on préfère la panne bruyante.
    const faux = {
      $queryRawUnsafe: async (sql: string) =>
        /journal_mode/.test(sql) ? [{ journal_mode: 'wal' }] : [{ synchronous: 1 }],
      $executeRawUnsafe: async () => 0,
      $transaction: async () => [],
    }
    await expect(appliquerMigrations({ prisma: faux, dossier: jeuJouet() })).rejects.toThrow(
      /synchronous/i,
    )
  })
})

describe('urlBaseDurable', () => {
  it("ne diverge pas de l'URL que le serveur se construit de son côté", () => {
    // Le lanceur (JavaScript) et l'application (TypeScript) ne peuvent pas
    // partager de code : deux mises en page, deux langages. Ce test est le lien
    // — sans lui, l'une des deux pourrait perdre la connexion unique dont
    // dépend toute la durabilité, sans que rien ne bronche.
    for (const fichier of ['/donnees/cra.db', '/Users/moi/Mon Dossier/cra/donnees/cra.db']) {
      expect(urlBaseDurable(fichier)).toBe(urlSqliteDurable(`file:${fichier}`))
    }
  })

  it('impose une connexion unique, sur laquelle seule le pragma vaut', () => {
    expect(urlBaseDurable('/d/cra.db')).toContain('connection_limit=1')
  })

  it('laisse un fichier -wal à côté de la base, signe visible du mode', async () => {
    const fichier = path.join(bac, 'cra.db')
    const prisma = ouvrir(fichier)
    await appliquerMigrations({ prisma, dossier: jeuJouet() })
    await prisma.$executeRawUnsafe(`INSERT INTO "Note" ("id","titre") VALUES ('n1','x')`)
    expect(existsSync(`${fichier}-wal`)).toBe(true)
  })

  it('est idempotent : un second passage ne réapplique rien', async () => {
    const dossier = jeuJouet()
    const prisma = ouvrir(path.join(bac, 'cra.db'))
    await appliquerMigrations({ prisma, dossier })
    const r = await appliquerMigrations({ prisma, dossier })
    expect(r.appliquees).toEqual([])
    expect(r.sauvegarde).toBeNull()
  })

  it('sauvegarde AVANT une migration sur une base déjà peuplée', async () => {
    const dossier = jeuJouet()
    const fichier = path.join(bac, 'cra.db')
    const sauvegardes = path.join(bac, 'sauvegardes')

    const prisma = ouvrir(fichier)
    await appliquerMigrations({ prisma, dossier })
    await prisma.$executeRawUnsafe(`INSERT INTO "Note" ("id","titre") VALUES ('n1','avant')`)

    ajouterSeconde(dossier)
    const r = await appliquerMigrations({
      prisma,
      dossier,
      avantMigration: () => sauvegarderBase(prisma, sauvegardes, 'avant-migration'),
    })

    expect(r.appliquees).toEqual(['20260202000000_couleur'])
    expect(r.sauvegarde).not.toBeNull()
    expect(existsSync(r.sauvegarde!)).toBe(true)

    // La colonne existe après ; la sauvegarde, prise avant, ne l'a pas.
    const apres = await prisma.$queryRawUnsafe<{ couleur: string | null }[]>(
      'SELECT couleur FROM "Note"',
    )
    expect(apres).toHaveLength(1)

    const copie = ouvrir(r.sauvegarde!)
    const lignes = await copie.$queryRawUnsafe<{ titre: string }[]>('SELECT titre FROM "Note"')
    expect(lignes.map((l) => l.titre)).toEqual(['avant'])
    await expect(copie.$queryRawUnsafe('SELECT couleur FROM "Note"')).rejects.toThrow()
  })

  it('ne sauvegarde pas à la toute première création', async () => {
    // Il n'y a rien à perdre : une sauvegarde d'une base vide n'aurait aucun sens.
    let appels = 0
    const prisma = ouvrir(path.join(bac, 'cra.db'))
    await appliquerMigrations({
      prisma,
      dossier: jeuJouet(),
      avantMigration: async () => {
        appels++
        return 'jamais'
      },
    })
    expect(appels).toBe(0)
  })

  it('applique le jeu réel du dépôt et rend une base exploitable', async () => {
    const prisma = ouvrir(path.join(bac, 'cra.db'))
    const r = await appliquerMigrations({ prisma, dossier: JEU_REEL })
    expect(r.appliquees.length).toBeGreaterThan(0)

    await prisma.user.create({
      data: { email: 'portable@test.local', name: 'P', passwordHash: 'x' },
    })
    expect(await prisma.user.count()).toBe(1)
    // Une colonne ajoutée tardivement au schéma : elle prouve que la migration
    // suit bien le schéma actuel et pas un état figé.
    const s = await prisma.settings.create({ data: { id: 'singleton' } })
    expect(s.themeJson).toBe('{}')
    expect(s.debutExerciceMois).toBe(1)
  })

  it("interrompt le démarrage plutôt que de mentir si WAL n'est pas obtenu", async () => {
    // Le LISEZMOI promet qu'éteindre ne perd rien. Si la journalisation ne
    // peut pas être posée (disque réseau, système de fichiers exotique), il
    // vaut mieux ne pas démarrer que démarrer sur une promesse fausse.
    const faux = {
      $queryRawUnsafe: async (sql: string) =>
        /journal_mode/.test(sql) ? [{ journal_mode: 'delete' }] : [],
      $executeRawUnsafe: async () => 0,
      $transaction: async () => [],
    }
    await expect(
      appliquerMigrations({ prisma: faux, dossier: jeuJouet() }),
    ).rejects.toThrow(/WAL/i)
  })
})

describe('sauvegarderBase', () => {
  it('produit un fichier daté lisible', async () => {
    const prisma = ouvrir(path.join(bac, 'cra.db'))
    await appliquerMigrations({ prisma, dossier: jeuJouet() })
    await prisma.$executeRawUnsafe(`INSERT INTO "Note" ("id","titre") VALUES ('n1','coucou')`)

    const dossier = path.join(bac, 'sauvegardes')
    const fichier = await sauvegarderBase(prisma, dossier, 'sauvegarde')

    expect(path.basename(fichier)).toMatch(/^sauvegarde-\d{8}-\d{6}(-\d+)?\.db$/)
    const copie = ouvrir(fichier)
    const lignes = await copie.$queryRawUnsafe<{ titre: string }[]>('SELECT titre FROM "Note"')
    expect(lignes.map((l) => l.titre)).toEqual(['coucou'])
  })

  it('ne réécrit jamais par-dessus une sauvegarde existante', async () => {
    // VACUUM INTO refuse une cible existante : sans dé-collision, deux
    // sauvegardes dans la même seconde feraient échouer la seconde.
    const prisma = ouvrir(path.join(bac, 'cra.db'))
    await appliquerMigrations({ prisma, dossier: jeuJouet() })
    const dossier = path.join(bac, 'sauvegardes')

    const a = await sauvegarderBase(prisma, dossier, 'sauvegarde')
    const b = await sauvegarderBase(prisma, dossier, 'sauvegarde')

    expect(a).not.toBe(b)
    expect(readdirSync(dossier).sort()).toHaveLength(2)
  })
})

describe('horodatage', () => {
  it('rend une chaîne triable', () => {
    expect(horodatage(new Date(2026, 7, 16, 9, 5, 3))).toBe('20260816-090503')
  })
})
