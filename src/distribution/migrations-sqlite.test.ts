import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { colonnesManquantes, uniquesManquantes } from '@/db/migration-sql'

// Le pendant SQLite de `src/db/schema-migration-sync.test.ts`. Le jeu
// `prisma/migrations/` est verrouillé sur Postgres (`migration_lock.toml`) et
// inapplicable à SQLite ; l'archive portable, elle, est en SQLite. Ce second
// jeu est rejoué par `outils/lib/migrations.mjs`, pas par le CLI Prisma —
// d'où l'absence volontaire de `migration_lock.toml` dans ce dossier : un
// fichier de verrou n'y ferait qu'inviter à un `migrate deploy` qui échouerait.
//
// Les types SQL ne sont pas comparés ici, contrairement au jeu Postgres :
// SQLite reçoit DATETIME là où Postgres reçoit TIMESTAMP(3), REAL là où
// Postgres reçoit DOUBLE PRECISION. Comparer les types demanderait une
// seconde table de correspondance dont le seul effet serait de recopier ce
// que `prisma migrate diff` vient de produire.

const ROOT = path.resolve(__dirname, '../..')
const SCHEMA_PATH = path.join(ROOT, 'prisma/schema.prisma')
const DIR = path.join(ROOT, 'prisma/migrations-sqlite')

function dossiers(): string[] {
  return readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

describe('jeu de migrations SQLite', () => {
  it('contient au moins une migration', () => {
    expect(dossiers().length).toBeGreaterThan(0)
  })

  it('chaque colonne scalaire du schéma existe dans les migrations SQLite', () => {
    const missing = colonnesManquantes(readFileSync(SCHEMA_PATH, 'utf8'), DIR)
    expect(
      missing,
      [
        'Colonnes déclarées dans prisma/schema.prisma mais absentes de',
        'prisma/migrations-sqlite/**/migration.sql :',
        missing.join(', '),
        '',
        "Une archive portable construite sur ce jeu créerait une base incomplète et l'application",
        'planterait sur la première route touchant ces colonnes. Régénérer hors ligne :',
        'npx prisma migrate diff --from-migrations prisma/migrations-sqlite \\',
        '  --to-schema-datamodel prisma/schema.prisma --script',
      ].join('\n'),
    ).toEqual([])
  })

  it("chaque contrainte d'unicité du schéma existe dans les migrations SQLite", () => {
    // Sans elle, la base portable accepterait deux saisies sur le même
    // créneau — la protection existerait côté Postgres et nulle part ailleurs.
    const missing = uniquesManquantes(readFileSync(SCHEMA_PATH, 'utf8'), DIR)
    expect(
      missing,
      [
        "Contraintes d'unicité déclarées dans prisma/schema.prisma mais absentes de",
        'prisma/migrations-sqlite/**/migration.sql (CREATE UNIQUE INDEX) :',
        missing.join(', '),
      ].join('\n'),
    ).toEqual([])
  })

  it('chaque dossier porte un préfixe horodaté triable', () => {
    for (const d of dossiers()) expect(d).toMatch(/^\d{14}_[a-z0-9_]+$/)
  })

  it("n'introduit aucun point-virgule à l'intérieur d'une chaîne littérale", () => {
    // Le moteur d'application découpe le SQL sur les points-virgules. Un ';'
    // dans un littéral ('a;b') couperait une instruction en deux et
    // produirait une migration à moitié appliquée. Le schéma actuel n'en a
    // aucun ; ce test empêche qu'il en apparaisse un sans qu'on le sache.
    for (const d of dossiers()) {
      const sql = readFileSync(path.join(DIR, d, 'migration.sql'), 'utf8')
      const litteraux = sql.match(/'(?:[^']|'')*'/g) ?? []
      const fautifs = litteraux.filter((l) => l.includes(';'))
      expect(fautifs, `${d}/migration.sql : littéraux contenant un ';'`).toEqual([])
    }
  })

  it('termine chaque migration par un point-virgule', () => {
    for (const d of dossiers()) {
      const sql = readFileSync(path.join(DIR, d, 'migration.sql'), 'utf8')
      const utile = sql
        .split('\n')
        .filter((l) => l.trim() !== '' && !l.trimStart().startsWith('--'))
        .join('\n')
        .trim()
      expect(utile.endsWith(';'), `${d}/migration.sql ne se termine pas par ';'`).toBe(true)
    }
  })

  // Ce test affirmait d'abord l'inverse — que le jeu ne devait porter aucun
  // verrou, « n'étant jamais confié au CLI Prisma ». La prémisse était fausse,
  // et l'a été démontrée en essayant : le jeu n'est pas confié au CLI à
  // l'exécution, mais il l'est en MAINTENANCE, par la commande qui le compare
  // au schéma quand celui-ci change. Sans verrou, elle refuse le dossier —
  // « Could not determine the connector from the migrations directory » — et
  // la seule issue restante serait de régénérer le jeu à plat, ce qui
  // casserait le journal des installations existantes.
  it('declare sqlite, sans quoi la comparaison au schema est impossible', () => {
    const lock = readFileSync(path.join(DIR, 'migration_lock.toml'), 'utf8')
    expect(lock).toContain('provider = "sqlite"')
  })

  it("ne declare pas le connecteur de l autre jeu", () => {
    const lock = readFileSync(path.join(DIR, 'migration_lock.toml'), 'utf8')
    expect(lock).not.toContain('postgresql')
  })
})

