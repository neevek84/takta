import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Garde-fou anti-dérive : chaque évolution de `prisma/schema.prisma` doit
// être accompagnée d'une migration Postgres à jour sous `prisma/migrations/`.
//
// Contexte : `npm run db:sqlite` (utilisé pendant tout le développement)
// passe par `prisma db push`, qui ne génère JAMAIS de migration. Rien
// n'empêchait donc historiquement un changement de schéma de partir sans
// que la migration Postgres suive — c'est exactement ce qui s'est produit
// entre le lot 0 et ce lot (`objectifCaExerciceCents`, `debutExerciceMois`,
// `themeJson` et la majorité des `minutesParJour` manquaient de la
// migration alors qu'ils existent dans le schéma).
//
// Ce test rejoue statiquement, en pur texte, les migrations SQL
// (CREATE TABLE / ALTER TABLE ADD|DROP|RENAME COLUMN / RENAME TABLE /
// DROP TABLE, dans l'ordre chronologique des dossiers) pour reconstruire
// l'état de colonnes qu'elles produisent, et le compare aux champs
// scalaires déclarés dans `schema.prisma`. Volontairement hors ligne : pas
// de connexion Postgres, pas de `prisma migrate diff --from-migrations`
// (qui exige un `--shadow-database-url` injoignable ici) — juste du texte,
// donc utilisable en CI sans serveur Postgres.

const ROOT = path.resolve(__dirname, '../..')
const SCHEMA_PATH = path.join(ROOT, 'prisma/schema.prisma')
const MIGRATIONS_DIR = path.join(ROOT, 'prisma/migrations')

// Types scalaires Prisma qui se traduisent en colonne SQL. La contrainte de
// portabilité SQLite/Postgres du projet exclut déjà les tableaux et les
// décimaux ; Decimal/tableaux ne sont donc pas attendus mais, s'ils
// apparaissaient, seraient ignorés ici plutôt que de déclencher une fausse
// alerte (mieux vaut un faux négatif ponctuel qu'un test qui bloque tout
// pour un type qu'il ne comprend pas).
const SCALAR_TYPES = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'BigInt', 'Json', 'Bytes'])

/** Extrait, pour chaque modèle, la liste des champs qui correspondent à une vraie colonne SQL. */
function parseSchemaModels(schemaSrc: string): Map<string, string[]> {
  const modelBlockRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g
  const rawModels: { name: string; body: string }[] = []
  let m: RegExpExecArray | null
  while ((m = modelBlockRe.exec(schemaSrc))) {
    // Groupes 1 et 2 sont non optionnels dans le motif : toujours définis si `m` matche.
    rawModels.push({ name: m[1]!, body: m[2]! })
  }
  const modelNames = new Set(rawModels.map((r) => r.name))

  const result = new Map<string, string[]>()
  for (const { name, body } of rawModels) {
    const columns: string[] = []
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('@@') || line.startsWith('//') || line.startsWith('///')) continue
      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\?)?(\[\])?/)
      if (!fieldMatch) continue
      const fieldName = fieldMatch[1]!
      const fieldType = fieldMatch[2]!
      const isArray = fieldMatch[4]
      if (isArray) continue // liste de relation : jamais une colonne (et le projet interdit les tableaux scalaires)
      if (modelNames.has(fieldType)) continue // relation vers un autre modèle : pas une colonne
      if (!SCALAR_TYPES.has(fieldType)) continue // type non reconnu : ignoré plutôt que fausse alerte
      columns.push(fieldName)
    }
    result.set(name, columns)
  }
  return result
}

/** Rejoue en texte les instructions DDL d'une migration sur l'état table -> colonnes en cours de construction. */
function applyMigrationSql(sql: string, tables: Map<string, Set<string>>): void {
  const createRe = /CREATE TABLE "(\w+)"\s*\(([\s\S]*?)\n\);/g
  let m: RegExpExecArray | null
  while ((m = createRe.exec(sql))) {
    const tableName = m[1]!
    const body = m[2]!
    const cols = new Set<string>()
    for (const rawLine of body.split('\n')) {
      const colMatch = rawLine.trim().match(/^"([^"]+)"/)
      if (colMatch) cols.add(colMatch[1]!)
    }
    tables.set(tableName, cols)
  }

  const dropTableRe = /DROP TABLE (?:IF EXISTS )?"(\w+)"/g
  while ((m = dropTableRe.exec(sql))) {
    tables.delete(m[1]!)
  }

  // Une seule instruction ALTER TABLE peut porter plusieurs clauses
  // (ADD COLUMN "a" ..., ADD COLUMN "b" ...) séparées par des virgules :
  // on capture tout le bloc jusqu'au ';' et on cherche chaque clause dedans.
  const alterRe = /ALTER TABLE "(\w+)"([\s\S]*?);/g
  while ((m = alterRe.exec(sql))) {
    const tableName = m[1]!
    const clauses = m[2]!
    const cols = tables.get(tableName)
    if (!cols) continue // table pas encore vue : ordre inattendu, ignoré volontairement

    const renameTableMatch = clauses.match(/RENAME TO "(\w+)"/)
    if (renameTableMatch) {
      tables.delete(tableName)
      tables.set(renameTableMatch[1]!, cols)
      continue
    }

    let am: RegExpExecArray | null
    const addColRe = /ADD COLUMN "([^"]+)"/g
    while ((am = addColRe.exec(clauses))) cols.add(am[1]!)

    const dropColRe = /DROP COLUMN "([^"]+)"/g
    while ((am = dropColRe.exec(clauses))) cols.delete(am[1]!)

    const renameColRe = /RENAME COLUMN "([^"]+)" TO "([^"]+)"/g
    while ((am = renameColRe.exec(clauses))) {
      cols.delete(am[1]!)
      cols.add(am[2]!)
    }
  }
}

function parseMigrationsState(migrationsDir: string): Map<string, Set<string>> {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort() // les dossiers sont préfixés par un timestamp : le tri lexical suit l'ordre chronologique

  const tables = new Map<string, Set<string>>()
  for (const dir of dirs) {
    let sql: string
    try {
      sql = readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8')
    } catch {
      continue
    }
    applyMigrationSql(sql, tables)
  }
  return tables
}

describe('synchronisation schema.prisma <-> migrations Postgres', () => {
  it('chaque colonne scalaire du schéma existe dans les migrations', () => {
    const schemaModels = parseSchemaModels(readFileSync(SCHEMA_PATH, 'utf8'))
    const migratedTables = parseMigrationsState(MIGRATIONS_DIR)

    const missing: string[] = []
    for (const [model, columns] of schemaModels) {
      const migratedColumns = migratedTables.get(model)
      if (!migratedColumns) {
        missing.push(`${model} (table entière absente des migrations)`)
        continue
      }
      for (const column of columns) {
        if (!migratedColumns.has(column)) missing.push(`${model}.${column}`)
      }
    }

    expect(
      missing,
      [
        'Colonnes déclarées dans prisma/schema.prisma mais absentes de prisma/migrations/**/migration.sql :',
        missing.join(', '),
        '',
        "Chaque évolution de schéma.prisma doit être accompagnée d'une migration régénérée hors ligne",
        '(voir README, section « Migrations futures ») — `npm run db:sqlite` seul (prisma db push) ne',
        'produit aucune migration et laisse le chemin Postgres cassé.',
      ].join('\n')
    ).toEqual([])
  })
})
