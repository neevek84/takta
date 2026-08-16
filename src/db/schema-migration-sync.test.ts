import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  PRISMA_TO_SQL_TYPE,
  colonnesManquantes,
  parseMigrationsState,
  parseSchemaModels,
  uniquesManquantes,
} from './migration-sql'

// Garde-fou anti-dérive : chaque évolution de `prisma/schema.prisma` doit
// être accompagnée d'une migration Postgres à jour sous `prisma/migrations/`.
//
// La mécanique de lecture (analyse du schéma, rejeu statique du DDL) vit
// désormais dans `src/db/migration-sql.ts` : le jeu de migrations SQLite de
// l'archive portable (`src/distribution/migrations-sqlite.test.ts`) a besoin
// du même garde-fou, et deux copies divergeraient. Le commentaire qui porte
// l'histoire du défaut corrigé a suivi les fonctions, dans ce module.

const ROOT = path.resolve(__dirname, '../..')
const SCHEMA_PATH = path.join(ROOT, 'prisma/schema.prisma')
const MIGRATIONS_DIR = path.join(ROOT, 'prisma/migrations')

describe('synchronisation schema.prisma <-> migrations Postgres', () => {
  it('chaque colonne scalaire du schéma existe dans les migrations', () => {
    const missing = colonnesManquantes(readFileSync(SCHEMA_PATH, 'utf8'), MIGRATIONS_DIR)

    expect(
      missing,
      [
        'Colonnes déclarées dans prisma/schema.prisma mais absentes de prisma/migrations/**/migration.sql :',
        missing.join(', '),
        '',
        "Chaque évolution de schéma.prisma doit être accompagnée d'une migration régénérée hors ligne",
        '(voir README, section « Migrations futures ») — `npm run db:sqlite` seul (prisma db push) ne',
        'produit aucune migration et laisse le chemin Postgres cassé.',
      ].join('\n'),
    ).toEqual([])
  })

  it('chaque colonne scalaire a le bon type et la bonne nullabilité dans les migrations', () => {
    const schemaModels = parseSchemaModels(readFileSync(SCHEMA_PATH, 'utf8'))
    const migratedState = parseMigrationsState(MIGRATIONS_DIR)

    const mismatches: string[] = []
    for (const [model, { columns }] of schemaModels) {
      const migratedColumns = migratedState.tables.get(model)
      if (!migratedColumns) continue // déjà signalé par le test précédent

      for (const [column, { type, nullable }] of columns) {
        const migrated = migratedColumns.get(column)
        if (!migrated) continue // déjà signalé par le test précédent

        const expectedSqlType = PRISMA_TO_SQL_TYPE[type]
        if (expectedSqlType && migrated.type !== expectedSqlType) {
          mismatches.push(
            `${model}.${column} : type ${migrated.type} en migration, ${expectedSqlType} attendu pour Prisma ${type}`,
          )
        }
        if (migrated.nullable !== nullable) {
          mismatches.push(
            `${model}.${column} : ${migrated.nullable ? 'nullable' : 'NOT NULL'} en migration, ` +
              `${nullable ? 'nullable' : 'NOT NULL'} attendu par schema.prisma`,
          )
        }
      }
    }

    expect(
      mismatches,
      [
        'Divergence de type ou de nullabilité entre prisma/schema.prisma et prisma/migrations/**/migration.sql :',
        mismatches.join('\n'),
        '',
        "Une colonne rendue nullable (ou dont le type change) dans le schéma doit être répercutée",
        "dans une migration Postgres régénérée hors ligne — voir README, section « Migrations futures ».",
      ].join('\n'),
    ).toEqual([])
  })

  it("chaque contrainte d'unicité du schéma existe dans les migrations", () => {
    const missing = uniquesManquantes(readFileSync(SCHEMA_PATH, 'utf8'), MIGRATIONS_DIR)

    expect(
      missing,
      [
        "Contraintes d'unicité (`@unique` / `@@unique`) déclarées dans prisma/schema.prisma mais absentes",
        'de prisma/migrations/**/migration.sql (CREATE UNIQUE INDEX) :',
        missing.join(', '),
        '',
        "C'est cette contrainte qui empêche par exemple deux saisies concurrentes sur le même créneau",
        '(TimeEntry) — sa perte en migration ne casserait rien en local (SQLite suit `schema.prisma`',
        'via `db push`) mais laisserait la base Postgres de production sans protection.',
      ].join('\n'),
    ).toEqual([])
  })
})
