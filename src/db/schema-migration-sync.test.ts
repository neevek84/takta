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
// (CREATE TABLE / ALTER TABLE ADD|DROP|RENAME COLUMN / ALTER COLUMN
// TYPE|SET|DROP NOT NULL / RENAME TABLE / DROP TABLE / CREATE|DROP INDEX,
// dans l'ordre chronologique des dossiers) pour reconstruire l'état de
// colonnes et de contraintes d'unicité qu'elles produisent, et le compare
// aux champs scalaires et aux `@unique`/`@@unique` déclarés dans
// `schema.prisma`. Volontairement hors ligne : pas de connexion Postgres,
// pas de `prisma migrate diff --from-migrations` (qui exige un
// `--shadow-database-url` injoignable ici) — juste du texte, donc
// utilisable en CI sans serveur Postgres.
//
// Portée volontairement limitée : les `@@index` simples (non uniques) ne
// sont pas vérifiés — ce sont des aides de performance, pas des garanties
// d'intégrité, et le risque documenté ici (une clé qui n'empêche plus une
// double saisie, une colonne devenue nullable) ne les concerne pas. Les
// valeurs par défaut ne sont pas comparées non plus : plusieurs sont
// posées côté client Prisma (`cuid()`, `updatedAt`) et n'ont pas
// d'équivalent SQL — les comparer produirait de fausses alertes sur des
// colonnes parfaitement synchronisées.

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

/** Traduction Postgres par défaut d'un type scalaire Prisma (sans `@db.*`). */
const PRISMA_TO_SQL_TYPE: Record<string, string> = {
  String: 'TEXT',
  Int: 'INTEGER',
  Float: 'DOUBLE PRECISION',
  Boolean: 'BOOLEAN',
  DateTime: 'TIMESTAMP(3)',
  BigInt: 'BIGINT',
  Json: 'JSONB',
  Bytes: 'BYTEA',
}

// Les seuls types SQL que ce garde-fou sait reconnaître : exactement ceux de
// PRISMA_TO_SQL_TYPE. Un type non reconnu est ignoré (voir SCALAR_TYPES)
// plutôt que de faire échouer le test.
const SQL_TYPE_RE = /(TEXT|INTEGER|BOOLEAN|TIMESTAMP\(\d+\)|DOUBLE PRECISION|BIGINT|JSONB|BYTEA)/

interface ColumnInfo {
  type: string
  nullable: boolean
}

interface ModelInfo {
  columns: Map<string, ColumnInfo>
  /** Chaque entrée : liste de champs triée et jointe par virgule (ex. "date,lineId,slotId,userId"). */
  uniques: Set<string>
}

/** Extrait, pour chaque modèle, les colonnes scalaires (type + nullabilité) et les contraintes d'unicité. */
function parseSchemaModels(schemaSrc: string): Map<string, ModelInfo> {
  const modelBlockRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g
  const rawModels: { name: string; body: string }[] = []
  let m: RegExpExecArray | null
  while ((m = modelBlockRe.exec(schemaSrc))) {
    // Groupes 1 et 2 sont non optionnels dans le motif : toujours définis si `m` matche.
    rawModels.push({ name: m[1]!, body: m[2]! })
  }
  const modelNames = new Set(rawModels.map((r) => r.name))

  const result = new Map<string, ModelInfo>()
  for (const { name, body } of rawModels) {
    const columns = new Map<string, ColumnInfo>()
    const uniques = new Set<string>()
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('//') || line.startsWith('///')) continue

      const uniqueBlockMatch = line.match(/^@@unique\(\[([^\]]+)\]/)
      if (uniqueBlockMatch) {
        const fields = uniqueBlockMatch[1]!
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean)
          .sort()
        uniques.add(fields.join(','))
        continue
      }
      if (line.startsWith('@@')) continue

      const fieldMatch = line.match(/^(\w+)\s+(\w+)(\?)?(\[\])?/)
      if (!fieldMatch) continue
      const fieldName = fieldMatch[1]!
      const fieldType = fieldMatch[2]!
      const isOptional = Boolean(fieldMatch[3])
      const isArray = fieldMatch[4]
      if (isArray) continue // liste de relation : jamais une colonne (et le projet interdit les tableaux scalaires)
      if (modelNames.has(fieldType)) continue // relation vers un autre modèle : pas une colonne
      if (!SCALAR_TYPES.has(fieldType)) continue // type non reconnu : ignoré plutôt que fausse alerte
      columns.set(fieldName, { type: fieldType, nullable: isOptional })
      // Attribut `@unique` sur un champ scalaire : contrainte à une seule colonne,
      // au même titre qu'un `@@unique([champ])`.
      if (/@unique\b/.test(line)) uniques.add(fieldName)
    }
    result.set(name, { columns, uniques })
  }
  return result
}

interface MigratedState {
  tables: Map<string, Map<string, ColumnInfo>>
  uniques: Map<string, Set<string>>
  /** Index nommé -> (table, clé d'unicité) qu'il porte, pour que DROP INDEX sache quoi retirer. */
  uniqueIndexByName: Map<string, { table: string; key: string }>
}

/** Extrait nom, type SQL reconnu et nullabilité d'une ligne de colonne `"col" TYPE [NOT NULL] [DEFAULT ...]`. */
function parseColumnDef(text: string): { name: string; type: string; nullable: boolean } | null {
  const nameMatch = text.match(/^"([^"]+)"\s+(.*)$/s)
  if (!nameMatch) return null
  const rest = nameMatch[2]!
  const typeMatch = rest.match(SQL_TYPE_RE)
  if (!typeMatch) return null // type non reconnu (ex. colonne d'une extension future) : ignoré
  return {
    name: nameMatch[1]!,
    type: typeMatch[1]!,
    nullable: !/\bNOT NULL\b/.test(rest),
  }
}

/** Rejoue en texte les instructions DDL d'une migration sur l'état en cours de construction. */
function applyMigrationSql(sql: string, state: MigratedState): void {
  const { tables, uniques, uniqueIndexByName } = state

  const createRe = /CREATE TABLE "(\w+)"\s*\(([\s\S]*?)\n\);/g
  let m: RegExpExecArray | null
  while ((m = createRe.exec(sql))) {
    const tableName = m[1]!
    const body = m[2]!
    const cols = new Map<string, ColumnInfo>()
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '')
      if (!line || line.startsWith('CONSTRAINT')) continue // clé primaire : hors périmètre de ce garde-fou
      const col = parseColumnDef(line)
      if (col) cols.set(col.name, { type: col.type, nullable: col.nullable })
    }
    tables.set(tableName, cols)
    uniques.set(tableName, new Set())
  }

  const dropTableRe = /DROP TABLE (?:IF EXISTS )?"(\w+)"/g
  while ((m = dropTableRe.exec(sql))) {
    tables.delete(m[1]!)
    uniques.delete(m[1]!)
  }

  // CREATE UNIQUE INDEX "Name" ON "Table"("a", "b");
  const createUniqueIdxRe = /CREATE UNIQUE INDEX "([^"]+)" ON "(\w+)"\(([^)]+)\)/g
  while ((m = createUniqueIdxRe.exec(sql))) {
    const indexName = m[1]!
    const tableName = m[2]!
    const cols = m[3]!
      .split(',')
      .map((c) => c.trim().replace(/^"|"$/g, ''))
      .sort()
    const key = cols.join(',')
    uniqueIndexByName.set(indexName, { table: tableName, key })
    if (!uniques.has(tableName)) uniques.set(tableName, new Set())
    uniques.get(tableName)!.add(key)
  }

  // DROP INDEX "Name"; — retire la contrainte d'unicité qu'elle portait, si connue.
  const dropIdxRe = /DROP INDEX (?:IF EXISTS )?"([^"]+)"/g
  while ((m = dropIdxRe.exec(sql))) {
    const indexName = m[1]!
    const entry = uniqueIndexByName.get(indexName)
    if (!entry) continue
    uniques.get(entry.table)?.delete(entry.key)
    uniqueIndexByName.delete(indexName)
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
      const newName = renameTableMatch[1]!
      tables.delete(tableName)
      tables.set(newName, cols)
      const tableUniques = uniques.get(tableName)
      uniques.delete(tableName)
      if (tableUniques) uniques.set(newName, tableUniques)
      // Les index déjà enregistrés sous l'ancien nom de table doivent suivre le renommage,
      // sinon un DROP INDEX ultérieur sur cette table ne retrouverait plus sa clé.
      for (const entry of uniqueIndexByName.values()) {
        if (entry.table === tableName) entry.table = newName
      }
      continue
    }

    let am: RegExpExecArray | null

    // ADD COLUMN "col" TYPE [NOT NULL] [DEFAULT ...] — jusqu'à la virgule ou au ';' suivant.
    const addColRe = /ADD COLUMN "([^"]+)"\s+([^,]+)/g
    while ((am = addColRe.exec(clauses))) {
      const col = parseColumnDef(`"${am[1]!}" ${am[2]!}`)
      if (col) cols.set(col.name, { type: col.type, nullable: col.nullable })
    }

    const dropColRe = /DROP COLUMN "([^"]+)"/g
    while ((am = dropColRe.exec(clauses))) cols.delete(am[1]!)

    const renameColRe = /RENAME COLUMN "([^"]+)" TO "([^"]+)"/g
    while ((am = renameColRe.exec(clauses))) {
      const prev = cols.get(am[1]!)
      cols.delete(am[1]!)
      if (prev) cols.set(am[2]!, prev)
    }

    // ALTER COLUMN "col" SET NOT NULL / DROP NOT NULL / SET DATA TYPE X / TYPE X
    const setNotNullRe = /ALTER COLUMN "([^"]+)" SET NOT NULL/g
    while ((am = setNotNullRe.exec(clauses))) {
      const col = cols.get(am[1]!)
      if (col) col.nullable = false
    }
    const dropNotNullRe = /ALTER COLUMN "([^"]+)" DROP NOT NULL/g
    while ((am = dropNotNullRe.exec(clauses))) {
      const col = cols.get(am[1]!)
      if (col) col.nullable = true
    }
    const setTypeRe = new RegExp(`ALTER COLUMN "([^"]+)" (?:SET DATA TYPE|TYPE) ${SQL_TYPE_RE.source}`, 'g')
    while ((am = setTypeRe.exec(clauses))) {
      const col = cols.get(am[1]!)
      if (col) col.type = am[2]!
    }
  }
}

function parseMigrationsState(migrationsDir: string): MigratedState {
  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort() // les dossiers sont préfixés par un timestamp : le tri lexical suit l'ordre chronologique

  const state: MigratedState = { tables: new Map(), uniques: new Map(), uniqueIndexByName: new Map() }
  for (const dir of dirs) {
    let sql: string
    try {
      sql = readFileSync(path.join(migrationsDir, dir, 'migration.sql'), 'utf8')
    } catch {
      continue
    }
    applyMigrationSql(sql, state)
  }
  return state
}

describe('synchronisation schema.prisma <-> migrations Postgres', () => {
  it('chaque colonne scalaire du schéma existe dans les migrations', () => {
    const schemaModels = parseSchemaModels(readFileSync(SCHEMA_PATH, 'utf8'))
    const migratedState = parseMigrationsState(MIGRATIONS_DIR)

    const missing: string[] = []
    for (const [model, { columns }] of schemaModels) {
      const migratedColumns = migratedState.tables.get(model)
      if (!migratedColumns) {
        missing.push(`${model} (table entière absente des migrations)`)
        continue
      }
      for (const column of columns.keys()) {
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
    const schemaModels = parseSchemaModels(readFileSync(SCHEMA_PATH, 'utf8'))
    const migratedState = parseMigrationsState(MIGRATIONS_DIR)

    const missing: string[] = []
    for (const [model, { uniques }] of schemaModels) {
      const migratedUniques = migratedState.uniques.get(model)
      for (const key of uniques) {
        if (!migratedUniques || !migratedUniques.has(key)) {
          missing.push(`${model}(${key})`)
        }
      }
    }

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
