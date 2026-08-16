# Lot 5 — Distribution portable · Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qu'une personne qui ne veut ni serveur ni Docker télécharge une archive, la dézippe, lance une commande — et surtout : qu'elle ose l'arrêter, la relancer et la mettre à jour sans jamais craindre pour ses six mois de CRA.

**Architecture:** Aucune modification du code applicatif. Une bibliothèque d'exploitation en JavaScript nu (`outils/`) embarquée dans la sortie `standalone`, un jeu de migrations SQLite appliqué par un moteur maison sans CLI Prisma, huit scripts d'entrée par plateforme, et un empaqueteur qui *prouve* que l'archive ne contient pas `donnees/`.

**Tech Stack:** Next.js 15 (`output: 'standalone'`) · Node ≥ 20 · Prisma 6 · SQLite en WAL · Vitest

**Spec :** `docs/superpowers/specs/2026-08-15-lot-5-distribution-portable-design.md`

---

## Global Constraints

Reprises de `docs/superpowers/ETAT.md`, applicables à toutes les tâches :

- **`src/core/` n'importe jamais `@prisma/client`, `next`, ni React.** Ce lot ne touche pas `src/core/`.
- **Aucun enum Prisma, aucun décimal, aucun tableau, aucune requête fine sur du JSON.** Portabilité SQLite/Postgres.
- **Entiers partout** : minutes, centièmes de jour, centimes.
- **Aucune page ni action serveur n'interroge Prisma directement.** Ce lot n'ajoute ni page ni action serveur.
- Français pour les chaînes visibles et toute la documentation utilisateur, **anglais pour le code et les messages de commit**. *(Exception assumée et déjà en vigueur dans le dépôt : les identifiants internes des scripts d'exploitation sont en français — `outils/`, `demarrer.sh`, `donnees/` — parce qu'ils sont eux-mêmes une surface visible par l'utilisateur final. Les messages de commit restent en anglais sans accent.)*
- **`vitest.config.ts` est en `fileParallelism: false`** — ne pas le modifier, ni son `include: ['src/**/*.test.{ts,tsx}']`. Les tests de ce lot vivent donc sous `src/distribution/` et importent les modules `.mjs` de `outils/` par chemin relatif ; `allowJs: true` est déjà dans `tsconfig.json` et `checkJs` n'est pas activé, donc `tsc --noEmit` ne typera pas ces `.mjs`.
- **Ne jamais lancer plusieurs agents exécutant `vitest` en même temps.**
- **Ne jamais lancer `npx next build` pendant que le serveur de développement tourne** : cela écrase son cache. **Ce lot construit — c'est son objet.** Il contourne le piège en construisant dans un `distDir` séparé (`CRA_DIST_DIR`, tâche 9), jamais dans `.next`. Si ce mécanisme devait échouer, la procédure de repli est : arrêter le serveur de développement, `rm -rf .next`, construire, `rm -rf .next`, relancer.
- **Ne jamais utiliser `git add -A`** — chemins explicites uniquement dans chaque commit.
- **TypeScript épinglé en `^5.9`.**
- **Node 22.11 ici** : pas de `jsdom`, pas de `node:sqlite` sans indicateur expérimental. Le moteur de migration passe donc par Prisma, jamais par `node:sqlite`.
- **Docker et Postgres n'ont jamais été exécutés dans cet environnement.** Ce lot n'y change rien et ne s'y appuie pas.

---

## Faits établis avant d'écrire ce plan

Mesurés dans l'arbre réel, pas supposés. Ils commandent plusieurs décisions.

| Fait | Mesure | Conséquence |
|---|---|---|
| `PRAGMA journal_mode` sur `prisma/dev.db` vaut **`delete`** | `[{"journal_mode":"delete"}]` | La phrase de la spec « l'application est configurée en WAL » est **fausse aujourd'hui**. La tâche 2 la rend vraie et le vérifie. |
| SQLite embarqué : **3.46.0**, `VACUUM INTO` fonctionne par `$executeRawUnsafe` | `VACUUM INTO ok`, fichier de 135 Ko produit | La sauvegarde ne dépend d'aucun binaire `sqlite3`. |
| `.next/standalone/node_modules` contient `@prisma/client`, `.prisma/client/libquery_engine-darwin-arm64.dylib.node`, `@node-rs/argon2` + `argon2-darwin-arm64` | `ls` | Aucun `npm install` au dézippage. La création d'utilisateur (argon2) fonctionne depuis l'archive. |
| `.next/standalone/node_modules` **ne contient pas** le paquet `prisma` (le CLI) | `ls` | `prisma migrate deploy` est **indisponible** dans l'archive. |
| `prisma/migrations/migration_lock.toml` déclare `provider = "postgresql"` | lecture | Le jeu de migrations existant est **inapplicable** à SQLite : `migrate deploy` refuserait le changement de provider. |
| `.next/standalone/.env` contient `DATABASE_URL="file:./dev.db"` et `AUTH_SECRET="dev-secret-non-production"` | lecture | Next **recopie le `.env` du dépôt** dans la sortie standalone. Livrer l'archive telle quelle diffuserait un secret de développement. À supprimer, avec un test. |
| `src/auth.config.ts` ne pose pas `trustHost` | lecture | En `NODE_ENV=production` hors Vercel, Auth.js v5 refuse un hôte non déclaré. Le lanceur doit poser `AUTH_TRUST_HOST=true`, sinon la page de connexion tombe en erreur. |
| `zip` et `unzip` sont présents (`/usr/bin`) | `which` | L'empaquetage et sa vérification ne demandent aucune dépendance npm. |

---

## Décisions tranchées, avec leur raison

1. **Le moteur de migration est écrit ici, il ne dépend pas du CLI Prisma.** Embarquer `prisma` obligerait à embarquer aussi le *schema engine* (≈ 20 Mo de plus par plateforme) et un sous-arbre `node_modules` que le traçage `standalone` n'inclut pas. Un moteur de 60 lignes qui rejoue des fichiers `.sql` et tient un journal `_cra_migrations` coûte moins, ne dépend d'aucun binaire supplémentaire, et — décisif — **est testable dans cet environnement**.
2. **Un jeu de migrations SQLite séparé, `prisma/migrations-sqlite/`.** Le jeu existant est verrouillé sur Postgres. Deux jeux, un par moteur, tous deux couverts par le même garde-fou statique.
3. **`outils/` est empaqueté dans `app/outils/`, pas à la racine de l'archive.** Node résout `@prisma/client` en remontant depuis le fichier importateur : posés à côté de `app/`, les outils ne verraient jamais `app/node_modules`.
4. **Les sauvegardes manuelles vont dans `donnees/sauvegardes/`, pas « à côté de l'application ».** *Écart assumé avec la spec §5.* La phrase qui compte — « copier `donnees/`, c'est tout sauvegarder » — ne serait plus littéralement vraie si les sauvegardes vivaient ailleurs, et la procédure de mise à jour (nouveau dossier + copie de `donnees/`) les laisserait derrière. À contester si le porteur préfère la lettre de la spec.
5. **Le navigateur ne s'ouvre pas quand aucun utilisateur n'existe.** Une page de connexion sans identifiants est l'impasse que la spec §3 veut éviter ; on affiche à la place la commande de création.
6. **Le fichier PID porte aussi le port**, et `arreter` ne tue que si quelque chose écoute encore sur ce port. Un PID recyclé par le système ferait sinon tuer un processus étranger.
7. **Construction dans un `distDir` dédié** (`CRA_DIST_DIR`), pour ne jamais écraser le cache du serveur de développement du porteur — piège nommé dans `ETAT.md` §7.
8. **`scripts/create-user.mjs` reste intact** (chemin Docker, documenté au README). `outils/creer-utilisateur.mjs` en est une réécriture de vingt lignes, avec un message d'usage qui parle de `./creer-utilisateur.sh`. Duplication délibérée : faire dépendre le script Docker de `outils/` tirerait la mise en page portable dans le conteneur.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `prisma/migrations-sqlite/20260816000000_init/migration.sql` | Schéma SQLite complet, dérivé hors ligne |
| `src/db/migration-sql.ts` | Helpers extraits du garde-fou existant, réutilisés par les deux jeux |
| `src/db/schema-migration-sync.test.ts` | *(modifié)* consomme les helpers extraits |
| `src/distribution/migrations-sqlite.test.ts` | Garde-fou du jeu SQLite + sûreté du découpage SQL |
| `outils/lib/chemins.mjs` | Racine d'installation, chemins de `donnees/` |
| `outils/lib/env.mjs` | `AUTH_SECRET` persistant |
| `outils/lib/port.mjs` | Choix d'un port libre |
| `outils/lib/processus.mjs` | Lecture du fichier PID, détection d'un port écouté |
| `outils/lib/sauvegarde.mjs` | `VACUUM INTO` daté |
| `outils/lib/migrations.mjs` | WAL + application des migrations en attente |
| `outils/lib/paquet.mjs` | Règles d'exclusion de l'archive — **le cœur du lot** |
| `outils/lib/lisezmoi.mjs` | Texte du `LISEZMOI`, généré |
| `outils/lancer.mjs` `arreter.mjs` `sauvegarder.mjs` `creer-utilisateur.mjs` | Les quatre commandes |
| `distribution/*.sh` `distribution/*.cmd` | Scripts d'entrée, contrôle de version de Node |
| `scripts/empaqueter.mjs` | Construction, mise en scène, archive, auto-contrôle |
| `next.config.ts` | *(modifié)* `distDir` paramétrable |
| `.gitignore` `.dockerignore` `package.json` `README.md` | *(modifiés)* |

**Dépendances :** 1, 3 et 8 sont indépendantes et parallélisables. 2 consomme 1 et 3. 4 consomme 2 et 3. 5, 6 consomment 3. 7 consomme 4, 5, 6. 9 consomme 7 et 8. 10 consomme tout.

---

## Task 1: Jeu de migrations SQLite et garde-fou statique

**Files:** Create `prisma/migrations-sqlite/20260816000000_init/migration.sql`, `src/db/migration-sql.ts`, `src/distribution/migrations-sqlite.test.ts`. Modify `src/db/schema-migration-sync.test.ts`.

**Interfaces:**
- Consumes: `prisma/schema.prisma`
- Produces:
  - `prisma/migrations-sqlite/<horodatage>_<nom>/migration.sql` — convention de nommage identique au jeu Postgres, tri lexical = ordre chronologique
  - `src/db/migration-sql.ts` : `parseSchemaModels(schemaSrc: string): Map<string, string[]>`, `parseMigrationsState(dir: string): Map<string, Set<string>>`, `colonnesManquantes(schemaSrc: string, dir: string): string[]`

- [ ] **Step 1: Extraire les helpers du garde-fou existant**

`src/db/schema-migration-sync.test.ts` contient déjà, aux lignes 28 à 141, `SCALAR_TYPES`, `parseSchemaModels`, `applyMigrationSql` et `parseMigrationsState`. Les **déplacer verbatim** dans `src/db/migration-sql.ts` en les exportant (`export const SCALAR_TYPES`, `export function parseSchemaModels`, `export function applyMigrationSql`, `export function parseMigrationsState`), en conservant intégralement les commentaires d'explication qui les accompagnent — ils portent l'historique du défaut corrigé.

Ajouter à la fin de `src/db/migration-sql.ts` :

```ts
/**
 * Colonnes déclarées dans le schéma mais absentes du jeu de migrations donné.
 * Le résultat vide est la seule forme acceptable ; toute entrée nomme
 * précisément ce qui manque, table par table.
 */
export function colonnesManquantes(schemaSrc: string, migrationsDir: string): string[] {
  const schemaModels = parseSchemaModels(schemaSrc)
  const migratedTables = parseMigrationsState(migrationsDir)

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
  return missing
}
```

Réduire `src/db/schema-migration-sync.test.ts` à son assertion, sans affaiblir le message :

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { colonnesManquantes } from './migration-sql'

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
})
```

- [ ] **Step 2: Vérifier que l'extraction n'a rien cassé**

Run: `npx vitest run src/db/schema-migration-sync.test.ts`
Expected: PASS — 1 test, exactement comme avant l'extraction.

- [ ] **Step 3: Générer la migration SQLite initiale**

Hors ligne, par pure dérivation du schéma — aucune base n'est jointe :

```bash
node scripts/set-db-provider.mjs sqlite
mkdir -p prisma/migrations-sqlite/20260816000000_init
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations-sqlite/20260816000000_init/migration.sql
head -20 prisma/migrations-sqlite/20260816000000_init/migration.sql
wc -l prisma/migrations-sqlite/20260816000000_init/migration.sql
```

Expected: un fichier commençant par `-- CreateTable` puis `CREATE TABLE "User" (`, sans `CREATE SCHEMA` (c'est du SQLite), et contenant les dix modèles du schéma.

**Aucun `migration_lock.toml` dans ce dossier**, volontairement : ce jeu n'est jamais confié au CLI Prisma, il est rejoué par `outils/lib/migrations.mjs`. Un fichier de verrou n'y ferait qu'inviter à un `migrate deploy` qui échouerait.

- [ ] **Step 4: Écrire le garde-fou du jeu SQLite**

`src/distribution/migrations-sqlite.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { colonnesManquantes } from '@/db/migration-sql'

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
})
```

- [ ] **Step 5: Lancer**

Run: `npx vitest run src/distribution/migrations-sqlite.test.ts src/db/schema-migration-sync.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Vérifier par mutation**

Ajouter temporairement un champ bidon au schéma (`champBidon String @default("x")` dans `model Settings`), relancer `npx vitest run src/distribution/migrations-sqlite.test.ts`, confirmer l'échec nommant `Settings.champBidon`, puis **retirer le champ** et relancer pour retrouver le vert. Sans cette vérification, rien ne prouve que le garde-fou regarde le bon dossier.

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations-sqlite src/db/migration-sql.ts src/db/schema-migration-sync.test.ts src/distribution/migrations-sqlite.test.ts
git commit -m "feat(db): sqlite migration set and its static drift guard"
```

---

## Task 2: Sauvegarde SQLite, WAL, et moteur de migration embarqué

**Files:** Create `outils/lib/sauvegarde.mjs`, `outils/lib/migrations.mjs`, `src/distribution/migrations.test.ts`

**Interfaces:**
- Consumes: `prisma/migrations-sqlite/` (tâche 1)
- Produces:
  - `horodatage(d?: Date): string` — `AAAAMMJJ-HHMMSS`
  - `sauvegarderBase(prisma, dossier, prefixe?): Promise<string>` — chemin absolu du fichier écrit
  - `decouperSql(sql: string): string[]`
  - `migrationsDisponibles(dossier: string): string[]`
  - `appliquerMigrations({ prisma, dossier, avantMigration? }): Promise<{ appliquees: string[]; sauvegarde: string | null }>`

- [ ] **Step 1: Écrire le test qui échoue**

`src/distribution/migrations.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { decouperSql, migrationsDisponibles, appliquerMigrations } from '../../outils/lib/migrations.mjs'
import { sauvegarderBase, horodatage } from '../../outils/lib/sauvegarde.mjs'

const RACINE_DEPOT = path.resolve(__dirname, '../..')
const JEU_REEL = path.join(RACINE_DEPOT, 'prisma/migrations-sqlite')

let bac = ''
let clients: PrismaClient[] = []

/** Ouvre un client Prisma sur un fichier SQLite précis, hors de la base de développement. */
function ouvrir(fichier: string): PrismaClient {
  const c = new PrismaClient({ datasources: { db: { url: `file:${fichier}` } } })
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
    const out = decouperSql('-- un commentaire\nCREATE TABLE "A" ("x" TEXT);\n-- autre\nDROP TABLE "A";\n')
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
    const noms = await prisma.$queryRawUnsafe<{ nom: string }[]>('SELECT nom FROM "_cra_migrations"')
    expect(noms.map((n) => n.nom)).toEqual(['20260101000000_init'])
  })

  it('met la base en journalisation WAL', async () => {
    // C'est la propriété qui autorise la phrase du LISEZMOI : arrêter ne perd
    // rien. Prisma laisse SQLite en mode `delete` par défaut — mesuré sur
    // prisma/dev.db avant ce lot. Sans cette ligne, la promesse serait fausse.
    const prisma = ouvrir(path.join(bac, 'cra.db'))
    await appliquerMigrations({ prisma, dossier: jeuJouet() })

    const mode = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode')
    expect(mode[0]!.journal_mode.toLowerCase()).toBe('wal')
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
    const apres = await prisma.$queryRawUnsafe<{ couleur: string | null }[]>('SELECT couleur FROM "Note"')
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
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run src/distribution/migrations.test.ts`
Expected: FAIL — `Failed to resolve import "../../outils/lib/migrations.mjs"`

- [ ] **Step 3: Écrire `outils/lib/sauvegarde.mjs`**

```js
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** Horodatage triable, en heure locale : AAAAMMJJ-HHMMSS. */
export function horodatage(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/**
 * Copie cohérente de la base, par la commande d'archivage de SQLite.
 *
 * `VACUUM INTO` est la seule façon d'obtenir un fichier utilisable pendant que
 * l'application écrit : une copie de fichier attraperait un `-wal` désynchronisé.
 * La commande refuse d'écrire par-dessus une cible existante, d'où la
 * dé-collision par suffixe.
 */
export async function sauvegarderBase(prisma, dossier, prefixe = 'sauvegarde') {
  mkdirSync(dossier, { recursive: true })

  const base = horodatage()
  let cible = path.join(dossier, `${prefixe}-${base}.db`)
  let n = 1
  while (existsSync(cible)) {
    cible = path.join(dossier, `${prefixe}-${base}-${n}.db`)
    n++
  }

  await prisma.$executeRawUnsafe(`VACUUM INTO '${cible.replace(/'/g, "''")}'`)
  return cible
}
```

- [ ] **Step 4: Écrire `outils/lib/migrations.mjs`**

```js
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Découpe un fichier de migration en instructions exécutables.
 *
 * Volontairement naïf : commentaires de ligne retirés, découpe sur ';'. Le SQL
 * produit par `prisma migrate diff` ne contient aucun point-virgule à
 * l'intérieur d'un littéral — et `src/distribution/migrations-sqlite.test.ts`
 * échoue si cela venait à changer. Rien de plus riche n'est nécessaire, et un
 * analyseur complet serait du code non couvert par l'usage réel.
 */
export function decouperSql(sql) {
  return sql
    .split('\n')
    .map((ligne) => (ligne.trimStart().startsWith('--') ? '' : ligne))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Dossiers de migration, triés — le préfixe horodaté fait du tri lexical un tri chronologique. */
export function migrationsDisponibles(dossier) {
  return readdirSync(dossier, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

/**
 * Met la base en WAL puis applique les migrations en attente.
 *
 * `avantMigration` n'est appelé que si des migrations restent à jouer ET que la
 * base en a déjà vu passer : à la toute première création il n'y a rien à
 * perdre. Une migration ratée se rattrape depuis la copie ; sans copie, non.
 */
export async function appliquerMigrations({ prisma, dossier, avantMigration }) {
  // Hors transaction : SQLite refuse un changement de mode de journalisation
  // à l'intérieur d'une. WAL est une propriété persistante du fichier, donc
  // écrite une fois et retrouvée à chaque ouverture — on la (re)pose quand
  // même à chaque démarrage, c'est gratuit et cela rattrape un fichier
  // restauré depuis une sauvegarde prise autrement.
  const journal = await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL')
  const mode = String(journal?.[0]?.journal_mode ?? '').toLowerCase()
  if (mode !== 'wal') {
    throw new Error(
      `SQLite a refusé la journalisation WAL (mode obtenu : « ${mode} »).\n` +
        "La durabilité annoncée dans le LISEZMOI ne serait plus garantie : démarrage interrompu.",
    )
  }

  await prisma.$executeRawUnsafe(
    'CREATE TABLE IF NOT EXISTS "_cra_migrations" (' +
      '"nom" TEXT NOT NULL PRIMARY KEY, "appliqueeLe" TEXT NOT NULL)',
  )

  const deja = new Set(
    (await prisma.$queryRawUnsafe('SELECT nom FROM "_cra_migrations"')).map((r) => r.nom),
  )
  const attente = migrationsDisponibles(dossier).filter((nom) => !deja.has(nom))
  if (attente.length === 0) return { appliquees: [], sauvegarde: null }

  const sauvegarde = deja.size > 0 && avantMigration ? await avantMigration() : null

  for (const nom of attente) {
    const sql = readFileSync(path.join(dossier, nom, 'migration.sql'), 'utf8')
    await prisma.$transaction([
      ...decouperSql(sql).map((instruction) => prisma.$executeRawUnsafe(instruction)),
      prisma.$executeRawUnsafe(
        'INSERT INTO "_cra_migrations" ("nom","appliqueeLe") VALUES (?, ?)',
        nom,
        new Date().toISOString(),
      ),
    ])
  }

  return { appliquees: attente, sauvegarde }
}
```

- [ ] **Step 5: Lancer pour vérifier le passage**

Run: `npx vitest run src/distribution/migrations.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 6: Vérifier par mutation**

Trois mutations, chacune restaurée après constat :

1. Retirer `PRAGMA journal_mode=WAL` (remplacer par `PRAGMA journal_mode`) → le test « met la base en journalisation WAL » doit échouer en montrant `delete`.
2. Déplacer l'appel `avantMigration` **après** la boucle d'application → le test « sauvegarde AVANT une migration » doit échouer sur `rejects.toThrow()` (la copie contiendrait déjà la colonne).
3. Remplacer `deja.size > 0 &&` par `true &&` → « ne sauvegarde pas à la toute première création » doit échouer avec `appels` à 1.

Si l'une des trois laisse tout au vert, le test correspondant ne sert à rien : le corriger avant d'aller plus loin.

- [ ] **Step 7: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0.

- [ ] **Step 8: Commit**

```bash
git add outils/lib/sauvegarde.mjs outils/lib/migrations.mjs src/distribution/migrations.test.ts
git commit -m "feat(portable): embedded sqlite migration engine, WAL and pre-migration backup"
```

---

## Task 3: Racine d'installation, environnement persistant, port et processus

**Files:** Create `outils/lib/chemins.mjs`, `outils/lib/env.mjs`, `outils/lib/port.mjs`, `outils/lib/processus.mjs`, `src/distribution/socle.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `racineDeLInstallation(depuis?: string): string` — `CRA_RACINE` d'abord, sinon remontée jusqu'au marqueur `LISEZMOI.txt`
  - `chemins(racine: string): { racine, app, donnees, base, pid, env, journal, sauvegardes, migrations }`
  - `creerDossierDonnees(c): void`
  - `chargerOuCreerEnv(cheminEnv: string): { AUTH_SECRET: string }`
  - `portLibre(port: number): Promise<boolean>`, `choisirPort(depuis?: number, essais?: number): Promise<number>`
  - `lireFichierPid(chemin: string): { pid: number; port: number; demarreLe: string | null } | null`
  - `quelquUnEcoute(port: number): Promise<boolean>` — consommé par `lancer.mjs` (tâche 4) **et** `arreter.mjs` (tâche 5) ; une seule définition, ici

- [ ] **Step 1: Écrire le test qui échoue**

`src/distribution/socle.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { racineDeLInstallation, chemins, creerDossierDonnees } from '../../outils/lib/chemins.mjs'
import { chargerOuCreerEnv } from '../../outils/lib/env.mjs'
import { portLibre, choisirPort } from '../../outils/lib/port.mjs'
import { lireFichierPid, quelquUnEcoute } from '../../outils/lib/processus.mjs'

let bac = ''

beforeEach(() => {
  bac = mkdtempSync(path.join(tmpdir(), 'cra-socle-'))
  delete process.env.CRA_RACINE
})

afterEach(() => {
  delete process.env.CRA_RACINE
  rmSync(bac, { recursive: true, force: true })
})

describe('racineDeLInstallation', () => {
  it('honore CRA_RACINE en priorité', () => {
    process.env.CRA_RACINE = bac
    expect(racineDeLInstallation('/nulle/part/lancer.mjs')).toBe(path.resolve(bac))
  })

  it('remonte jusqu au dossier portant LISEZMOI.txt', () => {
    mkdirSync(path.join(bac, 'app/outils/lib'), { recursive: true })
    writeFileSync(path.join(bac, 'LISEZMOI.txt'), 'coucou')
    const depuis = path.join(bac, 'app/outils/lib/chemins.mjs')
    expect(racineDeLInstallation(depuis)).toBe(bac)
  })

  it('échoue clairement plutôt que de deviner', () => {
    mkdirSync(path.join(bac, 'a/b'), { recursive: true })
    expect(() => racineDeLInstallation(path.join(bac, 'a/b/x.mjs'))).toThrow(/racine/i)
  })
})

describe('chemins', () => {
  it('place toutes les données sous donnees/', () => {
    const c = chemins(bac)
    for (const p of [c.base, c.pid, c.env, c.journal, c.sauvegardes]) {
      expect(p.startsWith(c.donnees + path.sep)).toBe(true)
    }
    expect(c.donnees).toBe(path.join(bac, 'donnees'))
    expect(c.migrations).toBe(path.join(bac, 'app', 'prisma', 'migrations-sqlite'))
  })

  it('crée donnees/ et donnees/sauvegardes/ sans se plaindre deux fois', () => {
    const c = chemins(bac)
    creerDossierDonnees(c)
    creerDossierDonnees(c)
    expect(existsSync(c.donnees)).toBe(true)
    expect(existsSync(c.sauvegardes)).toBe(true)
  })
})

describe('chargerOuCreerEnv', () => {
  it('génère un secret la première fois', () => {
    const f = path.join(bac, 'cra.env')
    const env = chargerOuCreerEnv(f)
    expect(env.AUTH_SECRET.length).toBeGreaterThanOrEqual(40)
    expect(readFileSync(f, 'utf8')).toContain('AUTH_SECRET=')
  })

  it('rend EXACTEMENT le même secret au démarrage suivant', () => {
    // Un secret régénéré à chaque lancement déconnecterait tout le monde à
    // chaque redémarrage — l'application deviendrait celle qu'on n'ose pas éteindre.
    const f = path.join(bac, 'cra.env')
    expect(chargerOuCreerEnv(f).AUTH_SECRET).toBe(chargerOuCreerEnv(f).AUTH_SECRET)
  })

  it('écrit le fichier en lecture propriétaire seule', () => {
    const f = path.join(bac, 'cra.env')
    chargerOuCreerEnv(f)
    expect(statSync(f).mode & 0o077).toBe(0)
  })

  it('regénère un secret si le fichier existe mais est vide', () => {
    const f = path.join(bac, 'cra.env')
    writeFileSync(f, '# rien\n')
    expect(chargerOuCreerEnv(f).AUTH_SECRET.length).toBeGreaterThanOrEqual(40)
  })
})

describe('choisirPort', () => {
  it('rend le port de départ quand il est libre', async () => {
    const p = await choisirPort(45000, 20)
    expect(p).toBe(45000)
  })

  it('saute un port occupé au lieu d échouer', async () => {
    // C'est la règle métier : un port occupé n'empêche jamais le démarrage.
    const squatteur = net.createServer()
    await new Promise<void>((r) => squatteur.listen(45100, '127.0.0.1', r))
    try {
      expect(await portLibre(45100)).toBe(false)
      expect(await choisirPort(45100, 20)).toBe(45101)
    } finally {
      await new Promise<void>((r) => squatteur.close(() => r()))
    }
  })

  it('échoue explicitement si toute la plage est prise', async () => {
    const squatteur = net.createServer()
    await new Promise<void>((r) => squatteur.listen(45200, '127.0.0.1', r))
    try {
      await expect(choisirPort(45200, 1)).rejects.toThrow(/port libre/i)
    } finally {
      await new Promise<void>((r) => squatteur.close(() => r()))
    }
  })
})

describe('lireFichierPid', () => {
  it('rend null quand le fichier est absent', () => {
    expect(lireFichierPid(path.join(bac, 'cra.pid'))).toBeNull()
  })

  it('rend null sur un fichier illisible plutôt que de lever', () => {
    // Un PID corrompu ne doit pas transformer `arreter` en pile d'appels.
    const f = path.join(bac, 'cra.pid')
    writeFileSync(f, 'ceci n est pas du JSON')
    expect(lireFichierPid(f)).toBeNull()
  })

  it('rend null quand le pid ou le port manque', () => {
    const f = path.join(bac, 'cra.pid')
    writeFileSync(f, JSON.stringify({ pid: 42 }))
    expect(lireFichierPid(f)).toBeNull()
  })

  it('relit ce que le lanceur a écrit', () => {
    const f = path.join(bac, 'cra.pid')
    writeFileSync(f, JSON.stringify({ pid: 4242, port: 3001, demarreLe: '2026-08-16T09:00:00.000Z' }))
    expect(lireFichierPid(f)).toEqual({
      pid: 4242,
      port: 3001,
      demarreLe: '2026-08-16T09:00:00.000Z',
    })
  })
})

describe('quelquUnEcoute', () => {
  it('voit un port occupé', async () => {
    const s = net.createServer()
    await new Promise<void>((r) => s.listen(45300, '127.0.0.1', r))
    try {
      expect(await quelquUnEcoute(45300)).toBe(true)
    } finally {
      await new Promise<void>((r) => s.close(() => r()))
    }
  })

  it('voit un port libre', async () => {
    expect(await quelquUnEcoute(45301)).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run src/distribution/socle.test.ts`
Expected: FAIL — `Failed to resolve import "../../outils/lib/chemins.mjs"`

- [ ] **Step 3: Écrire `outils/lib/chemins.mjs`**

```js
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Fichier présent à la racine de toute installation dézippée. */
const MARQUEUR = 'LISEZMOI.txt'

/**
 * Racine de l'installation (le dossier issu du dézippage).
 *
 * Les scripts d'entrée posent `CRA_RACINE` — ils sont les seuls à connaître le
 * dossier avec certitude. La remontée par marqueur n'est qu'un filet pour un
 * appel direct de `node app/outils/lancer.mjs`.
 */
export function racineDeLInstallation(depuis = fileURLToPath(import.meta.url)) {
  if (process.env.CRA_RACINE) return path.resolve(process.env.CRA_RACINE)

  let dossier = path.dirname(path.resolve(depuis))
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dossier, MARQUEUR))) return dossier
    const parent = path.dirname(dossier)
    if (parent === dossier) break
    dossier = parent
  }

  throw new Error(
    "Impossible de localiser la racine de l'installation : aucun LISEZMOI.txt trouvé en\n" +
      `remontant depuis ${depuis}. Lance ./demarrer.sh (ou demarrer.cmd) depuis le dossier dézippé.`,
  )
}

/** Tous les chemins d'exploitation, dérivés de la racine. Rien hors de `donnees/`. */
export function chemins(racine) {
  const donnees = path.join(racine, 'donnees')
  return {
    racine,
    app: path.join(racine, 'app'),
    donnees,
    base: path.join(donnees, 'cra.db'),
    pid: path.join(donnees, 'cra.pid'),
    env: path.join(donnees, 'cra.env'),
    journal: path.join(donnees, 'journal.log'),
    sauvegardes: path.join(donnees, 'sauvegardes'),
    migrations: path.join(racine, 'app', 'prisma', 'migrations-sqlite'),
  }
}

export function creerDossierDonnees(c) {
  mkdirSync(c.donnees, { recursive: true })
  mkdirSync(c.sauvegardes, { recursive: true })
}
```

- [ ] **Step 4: Écrire `outils/lib/env.mjs`**

```js
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Secret de session, généré une fois et conservé dans `donnees/`.
 *
 * Le régénérer à chaque démarrage invaliderait toutes les sessions : on serait
 * déconnecté à chaque redémarrage, ce qui reviendrait à punir l'arrêt.
 */
export function chargerOuCreerEnv(cheminEnv) {
  if (existsSync(cheminEnv)) {
    const valeurs = {}
    for (const ligne of readFileSync(cheminEnv, 'utf8').split('\n')) {
      const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) valeurs[m[1]] = m[2]
    }
    if (valeurs.AUTH_SECRET) return valeurs
  }

  const valeurs = { AUTH_SECRET: randomBytes(32).toString('base64') }
  writeFileSync(cheminEnv, `AUTH_SECRET=${valeurs.AUTH_SECRET}\n`, { mode: 0o600 })
  return valeurs
}
```

- [ ] **Step 5: Écrire `outils/lib/port.mjs`**

```js
import net from 'node:net'

/** Vrai si l'on peut écouter sur ce port en local. */
export function portLibre(port) {
  return new Promise((resolve) => {
    const serveur = net.createServer()
    serveur.once('error', () => resolve(false))
    serveur.once('listening', () => serveur.close(() => resolve(true)))
    serveur.listen(port, '127.0.0.1')
  })
}

/**
 * Premier port libre à partir de `depuis`.
 *
 * Il subsiste une fenêtre entre la libération du port sondé et sa prise par le
 * serveur : un autre programme peut se glisser entre les deux. C'est
 * improbable sur un poste personnel, et le seul remède réel serait de passer
 * une socket déjà liée au serveur Next, ce que sa sortie standalone ne permet
 * pas. Le lanceur traite le cas par son message d'échec, pas en l'ignorant.
 */
export async function choisirPort(depuis = 3000, essais = 50) {
  for (let port = depuis; port < depuis + essais; port++) {
    if (await portLibre(port)) return port
  }
  throw new Error(
    `Aucun port libre entre ${depuis} et ${depuis + essais - 1}. ` +
      'Ferme un programme qui occupe ces ports, puis relance.',
  )
}
```

- [ ] **Step 6: Écrire `outils/lib/processus.mjs`**

Une seule définition pour les deux commandes qui en ont besoin : `lancer` (« est-ce déjà démarré ? ») et `arreter` (« y a-t-il encore quelque chose à arrêter ? »). Deux copies divergeraient.

```js
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'

/** Contenu du fichier PID, ou null si absent, illisible ou incomplet. */
export function lireFichierPid(chemin) {
  if (!existsSync(chemin)) return null
  try {
    const brut = JSON.parse(readFileSync(chemin, 'utf8'))
    if (!Number.isInteger(brut.pid) || !Number.isInteger(brut.port)) return null
    return { pid: brut.pid, port: brut.port, demarreLe: brut.demarreLe ?? null }
  } catch {
    return null
  }
}

/** Vrai si quelque chose accepte une connexion sur ce port en local. */
export function quelquUnEcoute(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.setTimeout(500)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    const non = () => {
      socket.destroy()
      resolve(false)
    }
    socket.once('error', non)
    socket.once('timeout', non)
  })
}
```

- [ ] **Step 7: Lancer pour vérifier le passage**

Run: `npx vitest run src/distribution/socle.test.ts`
Expected: PASS — 18 tests.

- [ ] **Step 8: Commit**

```bash
git add outils/lib/chemins.mjs outils/lib/env.mjs outils/lib/port.mjs outils/lib/processus.mjs src/distribution/socle.test.ts
git commit -m "feat(portable): install root, persistent secret, dynamic port and pid handling"
```

---

## Task 4: `lancer.mjs` — démarrer

**Files:** Create `outils/lancer.mjs`

**Interfaces:**
- Consumes: `chemins`, `creerDossierDonnees`, `racineDeLInstallation`, `chargerOuCreerEnv`, `choisirPort`, `lireFichierPid`, `quelquUnEcoute` (tâche 3) ; `appliquerMigrations`, `sauvegarderBase` (tâche 2)
- Produces: écrit `donnees/cra.pid` au format `{"pid":number,"port":number,"demarreLe":string}` — relu par `lireFichierPid`, consommé par `arreter.mjs` (tâche 5)

Ce script n'a pas de test unitaire : il est presque entièrement fait d'effets (processus, réseau, navigateur). Il est vérifié **de bout en bout** à la tâche 10, sur l'archive réelle. Les parties qui pouvaient être extraites et testées l'ont été aux tâches 2 et 3 — c'est précisément pourquoi elles y sont.

- [ ] **Step 1: Écrire `outils/lancer.mjs`**

```js
import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { racineDeLInstallation, chemins, creerDossierDonnees } from './lib/chemins.mjs'
import { chargerOuCreerEnv } from './lib/env.mjs'
import { choisirPort } from './lib/port.mjs'
import { lireFichierPid, quelquUnEcoute } from './lib/processus.mjs'
import { appliquerMigrations } from './lib/migrations.mjs'
import { sauvegarderBase } from './lib/sauvegarde.mjs'

const racine = racineDeLInstallation(fileURLToPath(import.meta.url))
const c = chemins(racine)
creerDossierDonnees(c)

function echoue(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

// ── 1. Déjà démarré ? ────────────────────────────────────────────────────────
const enCours = lireFichierPid(c.pid)
if (enCours && (await quelquUnEcoute(enCours.port))) {
  console.log(`L'application tourne déjà : http://127.0.0.1:${enCours.port}`)
  console.log("Pour l'arrêter : ./arreter.sh")
  process.exit(0)
}
rmSync(c.pid, { force: true })

// ── 2. Environnement ─────────────────────────────────────────────────────────
// Chemin ABSOLU : Prisma résout un `file:` relatif par rapport au schéma, pas
// au dossier courant. Un chemin relatif créerait une base au mauvais endroit.
process.env.DATABASE_URL = `file:${c.base}`
const secrets = chargerOuCreerEnv(c.env)

// ── 3. Migrations, précédées de leur copie de sauvegarde ─────────────────────
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

let nbUtilisateurs = 0
let echecBase = null
try {
  const r = await appliquerMigrations({
    prisma,
    dossier: c.migrations,
    avantMigration: () => sauvegarderBase(prisma, c.sauvegardes, 'avant-migration'),
  })
  if (r.sauvegarde) {
    console.log(`Copie de sauvegarde écrite avant migration : ${r.sauvegarde}`)
  }
  if (r.appliquees.length > 0) {
    console.log(`Mise à jour de la base : ${r.appliquees.length} migration(s) appliquée(s).`)
  }
  nbUtilisateurs = await prisma.user.count()
} catch (e) {
  echecBase = e
} finally {
  // Toujours refermer : `echoue` appelle process.exit, qui saute le finally.
  await prisma.$disconnect()
}

if (echecBase) {
  echoue(
    "La préparation de la base a échoué et l'application n'a pas démarré.\n" +
      `Détail : ${echecBase.message}\n` +
      `Tes données sont intactes dans ${c.donnees}, avec les copies de sauvegarde sous ${c.sauvegardes}.`,
  )
}

// ── 4. Port ──────────────────────────────────────────────────────────────────
const port = await choisirPort(3000, 50)

// ── 5. Démarrage du serveur ──────────────────────────────────────────────────
const serveur = path.join(c.app, 'server.js')
if (!existsSync(serveur)) {
  echoue(
    `Fichier introuvable : ${serveur}\n` +
      "L'archive semble incomplète. Dézippe-la de nouveau, entièrement.",
  )
}

const journal = openSync(c.journal, 'a')
const enfant = spawn(process.execPath, [serveur], {
  cwd: c.app,
  detached: true,
  stdio: ['ignore', journal, journal],
  env: {
    ...process.env,
    ...secrets,
    NODE_ENV: 'production',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    // Auth.js v5 refuse un hôte non déclaré hors Vercel dès que NODE_ENV vaut
    // production : sans cette ligne, la page de connexion tombe en UntrustedHost.
    AUTH_TRUST_HOST: 'true',
  },
})
enfant.unref()

writeFileSync(
  c.pid,
  JSON.stringify({ pid: enfant.pid, port, demarreLe: new Date().toISOString() }) + '\n',
)

// ── 6. Attente de la première réponse ────────────────────────────────────────
const url = `http://127.0.0.1:${port}`
const limite = Date.now() + 60_000
let repond = false
while (Date.now() < limite) {
  try {
    const res = await fetch(`${url}/login`, { redirect: 'manual' })
    if (res.status < 500) {
      repond = true
      break
    }
  } catch {
    // pas encore là
  }
  await new Promise((r) => setTimeout(r, 300))
}

if (!repond) {
  const fin = existsSync(c.journal) ? readFileSync(c.journal, 'utf8').split('\n').slice(-25).join('\n') : ''
  echoue(
    "L'application n'a pas répondu au bout de 60 secondes. Elle a été laissée en place ;\n" +
      `pour l'arrêter : ./arreter.sh\n\nDernières lignes de ${c.journal} :\n${fin}`,
  )
}

// ── 7. Compte rendu ──────────────────────────────────────────────────────────
console.log('')
console.log(`  CRA est démarré : ${url}`)
console.log('')

if (nbUtilisateurs === 0) {
  console.log("  Aucun utilisateur n'existe encore. Dans un autre terminal, lance :")
  console.log('')
  console.log('    ./creer-utilisateur.sh moi@exemple.fr "Mon Nom" monmotdepasse')
  console.log('')
  console.log(`  puis ouvre ${url} dans ton navigateur.`)
  console.log('')
} else {
  ouvrirNavigateur(url)
  console.log("  Le navigateur devrait s'ouvrir. Sinon, saisis l'adresse ci-dessus.")
  console.log('')
}

console.log('  Pour arrêter : ./arreter.sh — aucune donnée enregistrée ne sera perdue.')
console.log('')

function ouvrirNavigateur(adresse) {
  const [commande, args] =
    process.platform === 'darwin'
      ? ['open', [adresse]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', adresse]]
        : ['xdg-open', [adresse]]
  try {
    spawn(commande, args, { detached: true, stdio: 'ignore' }).unref()
  } catch {
    // Pas de navigateur joignable : l'adresse est déjà affichée, ce n'est pas un échec.
  }
}
```

- [ ] **Step 2: Contrôle syntaxique**

Run: `node --check outils/lancer.mjs`
Expected: aucune sortie.

*(Le comportement réel — migrations, port, PID, ouverture du navigateur — est éprouvé à la tâche 10 sur l'archive dézippée. Le vérifier ici, dans l'arbre du dépôt, prouverait autre chose que ce qu'on livre.)*

- [ ] **Step 3: Commit**

```bash
git add outils/lancer.mjs
git commit -m "feat(portable): start command with migrations, free port and browser launch"
```

---

## Task 5: `arreter.mjs` — arrêter sans crainte

**Files:** Create `outils/arreter.mjs`

**Interfaces:**
- Consumes: `chemins`, `racineDeLInstallation`, `lireFichierPid`, `quelquUnEcoute` (tâche 3) ; `donnees/cra.pid` écrit par `lancer.mjs` (tâche 4)
- Produces: rien de réutilisable — une commande terminale

`lireFichierPid` et `quelquUnEcoute` sont déjà écrits et testés à la tâche 3, parce que `lancer.mjs` en a besoin lui aussi. Il ne reste ici que l'orchestration, faite d'effets : elle est éprouvée à la tâche 10, steps 6 et 7.

- [ ] **Step 1: Écrire `outils/arreter.mjs`**

```js
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { racineDeLInstallation, chemins } from './lib/chemins.mjs'
import { lireFichierPid, quelquUnEcoute } from './lib/processus.mjs'

const c = chemins(racineDeLInstallation(fileURLToPath(import.meta.url)))
const attendu = lireFichierPid(c.pid)

const RASSURANT = "Aucune donnée enregistrée n'est perdue : SQLite écrit sur le disque à chaque saisie validée."

if (attendu === null) {
  console.log("L'application n'est pas démarrée.")
  rmSync(c.pid, { force: true })
  process.exit(0)
}

// Un PID est recyclé par le système : celui inscrit dans le fichier peut
// désigner aujourd'hui un tout autre programme. On ne tue donc que si quelque
// chose écoute encore sur le port enregistré au démarrage.
if (!(await quelquUnEcoute(attendu.port))) {
  rmSync(c.pid, { force: true })
  console.log("L'application n'était plus en cours d'exécution. Repère périmé nettoyé.")
  console.log(RASSURANT)
  process.exit(0)
}

try {
  process.kill(attendu.pid, 'SIGTERM')
} catch (e) {
  if (e.code !== 'ESRCH') throw e
}

const limite = Date.now() + 10_000
let arrete = false
while (Date.now() < limite) {
  if (!(await quelquUnEcoute(attendu.port))) {
    arrete = true
    break
  }
  await new Promise((r) => setTimeout(r, 200))
}

if (!arrete) {
  console.log("L'arrêt en douceur n'a pas abouti en 10 secondes : arrêt forcé.")
  try {
    process.kill(attendu.pid, 'SIGKILL')
  } catch (e) {
    if (e.code !== 'ESRCH') throw e
  }
}

rmSync(c.pid, { force: true })
console.log('Application arrêtée.')
console.log(RASSURANT)
```

- [ ] **Step 2: Contrôle syntaxique**

Run: `node --check outils/arreter.mjs`
Expected: aucune sortie.

- [ ] **Step 3: Commit**

```bash
git add outils/arreter.mjs
git commit -m "feat(portable): safe stop command, resilient to stale and recycled pids"
```

---

## Task 6: `sauvegarder.mjs` et `creer-utilisateur.mjs`

**Files:** Create `outils/sauvegarder.mjs`, `outils/creer-utilisateur.mjs`

**Interfaces:**
- Consumes: `chemins` (tâche 3), `sauvegarderBase` (tâche 2)
- Produces: deux commandes autonomes, sans nouvel export

- [ ] **Step 1: Écrire `outils/sauvegarder.mjs`**

```js
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { racineDeLInstallation, chemins, creerDossierDonnees } from './lib/chemins.mjs'
import { sauvegarderBase } from './lib/sauvegarde.mjs'

const c = chemins(racineDeLInstallation(fileURLToPath(import.meta.url)))
creerDossierDonnees(c)

if (!existsSync(c.base)) {
  console.error(
    "Aucune base à sauvegarder : l'application n'a jamais été démarrée sur cette installation.",
  )
  process.exit(1)
}

process.env.DATABASE_URL = `file:${c.base}`
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

try {
  const fichier = await sauvegarderBase(prisma, c.sauvegardes, 'sauvegarde')
  console.log(`Sauvegarde écrite : ${fichier}`)
  console.log("Elle est cohérente même si l'application tourne : c'est une archive SQLite, pas une copie de fichier.")
  console.log(`Rappel : tout est dans ${c.donnees} — copier ce dossier, c'est tout sauvegarder.`)
} finally {
  await prisma.$disconnect()
}
```

- [ ] **Step 2: Écrire `outils/creer-utilisateur.mjs`**

```js
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { racineDeLInstallation, chemins, creerDossierDonnees } from './lib/chemins.mjs'

const [email, nom, motDePasse] = process.argv.slice(2)
if (!email || !nom || !motDePasse) {
  console.error('Usage : ./creer-utilisateur.sh <email> "<nom>" <motdepasse>')
  console.error('Exemple : ./creer-utilisateur.sh moi@exemple.fr "Mon Nom" monmotdepasse')
  process.exit(1)
}

const c = chemins(racineDeLInstallation(fileURLToPath(import.meta.url)))
creerDossierDonnees(c)

if (!existsSync(c.base)) {
  console.error(
    "La base n'existe pas encore. Lance d'abord ./demarrer.sh une première fois,\n" +
      'puis relance cette commande dans un autre terminal.',
  )
  process.exit(1)
}

process.env.DATABASE_URL = `file:${c.base}`
const { PrismaClient } = await import('@prisma/client')
const { hash } = await import('@node-rs/argon2')

const prisma = new PrismaClient()
try {
  const passwordHash = await hash(motDePasse)
  await prisma.user.upsert({
    where: { email },
    create: { email, name: nom, passwordHash, role: 'ADMIN' },
    update: { passwordHash },
  })
  console.log(`Utilisateur ${email} créé (ou mot de passe mis à jour).`)
} finally {
  await prisma.$disconnect()
}
```

*(Vingt lignes qui recoupent `scripts/create-user.mjs`. Duplication assumée : le script Docker ne doit pas dépendre de la mise en page portable, et le message d'usage doit parler du script que l'utilisateur a réellement sous la main.)*

- [ ] **Step 3: Contrôle syntaxique**

Run: `node --check outils/sauvegarder.mjs && node --check outils/creer-utilisateur.mjs`
Expected: aucune sortie.

- [ ] **Step 4: Commit**

```bash
git add outils/sauvegarder.mjs outils/creer-utilisateur.mjs
git commit -m "feat(portable): backup and user-creation commands"
```

---

## Task 7: Scripts d'entrée par plateforme et contrôle de la version de Node

**Files:** Create `distribution/demarrer.sh`, `distribution/arreter.sh`, `distribution/sauvegarder.sh`, `distribution/creer-utilisateur.sh`, `distribution/demarrer.cmd`, `distribution/arreter.cmd`, `distribution/sauvegarder.cmd`, `distribution/creer-utilisateur.cmd`, `src/distribution/scripts-entree.test.ts`

**Interfaces:**
- Consumes: `outils/*.mjs` (tâches 4, 5, 6)
- Produces: huit fichiers copiés tels quels à la racine de l'archive ; chacun pose `CRA_RACINE` et appelle `node app/outils/<outil>.mjs`

- [ ] **Step 1: Écrire les quatre scripts POSIX**

`distribution/demarrer.sh` :

```sh
#!/bin/sh
# Demarre l'application CRA. Voir LISEZMOI.txt
set -e

RACINE="$(cd "$(dirname "$0")" && pwd)"
CRA_RACINE="$RACINE"
export CRA_RACINE

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js n'est pas installe sur cet ordinateur."
  echo "  Installe Node.js 20 ou plus depuis https://nodejs.org"
  echo "  puis relance ./demarrer.sh"
  echo ""
  exit 1
fi

VERSION="$(node -v)"
MAJEURE="$(echo "$VERSION" | sed 's/^v//' | cut -d. -f1)"
case "$MAJEURE" in
  ''|*[!0-9]*)
    echo ""
    echo "  Impossible de lire la version de Node.js (reponse : \"$VERSION\")."
    echo "  Reinstalle Node.js 20 ou plus depuis https://nodejs.org"
    echo ""
    exit 1
    ;;
esac

if [ "$MAJEURE" -lt 20 ]; then
  echo ""
  echo "  Node.js $VERSION est trop ancien : il faut la version 20 ou plus."
  echo "  Installe une version recente depuis https://nodejs.org"
  echo "  puis relance ./demarrer.sh"
  echo ""
  exit 1
fi

# macOS marque en quarantaine tout ce qui sort d'une archive telechargee ; le
# moteur natif de Prisma serait refuse au chargement. Sans effet ailleurs.
if [ "$(uname)" = "Darwin" ]; then
  xattr -dr com.apple.quarantine "$RACINE" 2>/dev/null || true
fi

exec node "$RACINE/app/outils/lancer.mjs" "$@"
```

`distribution/arreter.sh` — même en-tête, jusqu'à la ligne `exec` incluse, avec `arreter.mjs` :

```sh
#!/bin/sh
# Arrete l'application CRA. Voir LISEZMOI.txt
set -e

RACINE="$(cd "$(dirname "$0")" && pwd)"
CRA_RACINE="$RACINE"
export CRA_RACINE

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js n'est pas installe sur cet ordinateur."
  echo "  Installe Node.js 20 ou plus depuis https://nodejs.org"
  echo "  puis relance ./arreter.sh"
  echo ""
  exit 1
fi

VERSION="$(node -v)"
MAJEURE="$(echo "$VERSION" | sed 's/^v//' | cut -d. -f1)"
case "$MAJEURE" in
  ''|*[!0-9]*)
    echo ""
    echo "  Impossible de lire la version de Node.js (reponse : \"$VERSION\")."
    echo "  Reinstalle Node.js 20 ou plus depuis https://nodejs.org"
    echo ""
    exit 1
    ;;
esac

if [ "$MAJEURE" -lt 20 ]; then
  echo ""
  echo "  Node.js $VERSION est trop ancien : il faut la version 20 ou plus."
  echo "  Installe une version recente depuis https://nodejs.org"
  echo "  puis relance ./arreter.sh"
  echo ""
  exit 1
fi

exec node "$RACINE/app/outils/arreter.mjs" "$@"
```

`distribution/sauvegarder.sh` et `distribution/creer-utilisateur.sh` : identiques à `arreter.sh`, en remplaçant partout `arreter.sh` par le nom du script et `arreter.mjs` par `sauvegarder.mjs` / `creer-utilisateur.mjs`. Seul `demarrer.sh` porte le bloc `xattr` — c'est le seul qui charge le moteur natif.

- [ ] **Step 2: Écrire les quatre scripts Windows**

`distribution/demarrer.cmd` (**fins de ligne CRLF**) :

```bat
@echo off
rem Demarre l'application CRA. Voir LISEZMOI.txt
setlocal

set "RACINE=%~dp0"
if "%RACINE:~-1%"=="\" set "RACINE=%RACINE:~0,-1%"
set "CRA_RACINE=%RACINE%"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js n'est pas installe sur cet ordinateur.
  echo   Installe Node.js 20 ou plus depuis https://nodejs.org
  echo   puis relance demarrer.cmd
  echo.
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v') do set "MAJEURE=%%v"
set "MAJEURE=%MAJEURE:v=%"

echo %MAJEURE%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo.
  echo   Impossible de lire la version de Node.js.
  echo   Reinstalle Node.js 20 ou plus depuis https://nodejs.org
  echo.
  exit /b 1
)

if %MAJEURE% LSS 20 (
  echo.
  echo   Node.js version %MAJEURE% est trop ancien : il faut la version 20 ou plus.
  echo   Installe une version recente depuis https://nodejs.org
  echo   puis relance demarrer.cmd
  echo.
  exit /b 1
)

node "%RACINE%\app\outils\lancer.mjs" %*
exit /b %errorlevel%
```

`arreter.cmd`, `sauvegarder.cmd`, `creer-utilisateur.cmd` : mêmes blocs, avec le nom de script et l'outil correspondants.

- [ ] **Step 3: Écrire le test de parité**

Les `.cmd` ne peuvent pas être exécutés ici. Ce qu'on peut prouver, c'est qu'ils **disent la même chose** que leur homologue POSIX — c'est le défaut réaliste (un script Windows oublié lors d'une évolution), pas une erreur de syntaxe batch.

`src/distribution/scripts-entree.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const DIR = path.resolve(__dirname, '../../distribution')
const PAIRES = [
  { nom: 'demarrer', outil: 'lancer' },
  { nom: 'arreter', outil: 'arreter' },
  { nom: 'sauvegarder', outil: 'sauvegarder' },
  { nom: 'creer-utilisateur', outil: 'creer-utilisateur' },
]

describe('scripts d entree', () => {
  it('existent par paire, POSIX et Windows', () => {
    for (const { nom } of PAIRES) {
      expect(existsSync(path.join(DIR, `${nom}.sh`)), `${nom}.sh`).toBe(true)
      expect(existsSync(path.join(DIR, `${nom}.cmd`)), `${nom}.cmd`).toBe(true)
    }
  })

  it('appellent chacun le bon outil, des deux côtés', () => {
    for (const { nom, outil } of PAIRES) {
      const sh = readFileSync(path.join(DIR, `${nom}.sh`), 'utf8')
      const cmd = readFileSync(path.join(DIR, `${nom}.cmd`), 'utf8')
      expect(sh, `${nom}.sh`).toContain(`app/outils/${outil}.mjs`)
      expect(cmd, `${nom}.cmd`).toContain(`app\\outils\\${outil}.mjs`)
    }
  })

  it('posent CRA_RACINE des deux côtés', () => {
    for (const { nom } of PAIRES) {
      expect(readFileSync(path.join(DIR, `${nom}.sh`), 'utf8')).toContain('CRA_RACINE')
      expect(readFileSync(path.join(DIR, `${nom}.cmd`), 'utf8')).toContain('CRA_RACINE')
    }
  })

  it('exigent Node 20 des deux côtés, avant toute autre chose', () => {
    for (const { nom, outil } of PAIRES) {
      const sh = readFileSync(path.join(DIR, `${nom}.sh`), 'utf8')
      const cmd = readFileSync(path.join(DIR, `${nom}.cmd`), 'utf8')
      expect(sh).toContain('-lt 20')
      expect(cmd).toContain('LSS 20')
      // Le contrôle doit précéder l'appel : sinon Node ancien produit une pile.
      expect(sh.indexOf('-lt 20')).toBeLessThan(sh.indexOf(`${outil}.mjs`))
      expect(cmd.indexOf('LSS 20')).toBeLessThan(cmd.indexOf(`${outil}.mjs`))
    }
  })

  it('nomment nodejs.org dans chaque message d échec', () => {
    for (const { nom } of PAIRES) {
      for (const ext of ['sh', 'cmd']) {
        expect(readFileSync(path.join(DIR, `${nom}.${ext}`), 'utf8')).toContain('https://nodejs.org')
      }
    }
  })

  it('livrent les .cmd en CRLF', () => {
    // Un .cmd en LF se comporte de façon erratique sous cmd.exe.
    for (const { nom } of PAIRES) {
      const brut = readFileSync(path.join(DIR, `${nom}.cmd`), 'utf8')
      const lf = (brut.match(/\n/g) ?? []).length
      const crlf = (brut.match(/\r\n/g) ?? []).length
      expect(crlf, `${nom}.cmd`).toBe(lf)
    }
  })

  it('livrent les .sh en LF, avec un shebang', () => {
    for (const { nom } of PAIRES) {
      const brut = readFileSync(path.join(DIR, `${nom}.sh`), 'utf8')
      expect(brut.startsWith('#!/bin/sh')).toBe(true)
      expect(brut).not.toContain('\r\n')
    }
  })

  it('ne nettoie la quarantaine macOS que dans demarrer.sh', () => {
    expect(readFileSync(path.join(DIR, 'demarrer.sh'), 'utf8')).toContain('com.apple.quarantine')
    for (const { nom } of PAIRES.filter((p) => p.nom !== 'demarrer')) {
      expect(readFileSync(path.join(DIR, `${nom}.sh`), 'utf8')).not.toContain('com.apple.quarantine')
    }
  })
})
```

- [ ] **Step 4: Poser les bits d'exécution et vérifier la syntaxe des `.sh`**

```bash
chmod 755 distribution/demarrer.sh distribution/arreter.sh distribution/sauvegarder.sh distribution/creer-utilisateur.sh
for f in distribution/*.sh; do sh -n "$f" && echo "OK $f"; done
```

Expected: `OK distribution/arreter.sh`, `OK distribution/creer-utilisateur.sh`, `OK distribution/demarrer.sh`, `OK distribution/sauvegarder.sh`.

- [ ] **Step 5: Vérifier le refus d'un Node trop ancien, ici, pour de vrai**

Un faux `node` en tête de `PATH` suffit à éprouver le chemin d'échec :

```bash
BAC=$(mktemp -d)
mkdir -p "$BAC/faux"
printf '#!/bin/sh\necho v18.20.0\n' > "$BAC/faux/node"
chmod 755 "$BAC/faux/node"
cp distribution/demarrer.sh "$BAC/demarrer.sh"
mkdir -p "$BAC/app/outils"
PATH="$BAC/faux:$PATH" sh "$BAC/demarrer.sh"; echo "code de sortie : $?"
rm -rf "$BAC"
```

Expected: le message « Node.js v18.20.0 est trop ancien : il faut la version 20 ou plus. », puis `code de sortie : 1`. **Aucune pile d'appels.**

- [ ] **Step 6: Lancer les tests**

Run: `npx vitest run src/distribution/scripts-entree.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 7: Commit**

```bash
git add distribution src/distribution/scripts-entree.test.ts
git commit -m "feat(portable): per-platform entry scripts with a node version gate"
```

---

## Task 8: Le LISEZMOI

**Files:** Create `outils/lib/lisezmoi.mjs`, `src/distribution/lisezmoi.test.ts`

**Interfaces:**
- Consumes: rien
- Produces: `texteLisezmoi({ plateforme: string; version: string }): string` — consommé par `scripts/empaqueter.mjs` (tâche 9)

Le `LISEZMOI` est généré, pas recopié, pour une seule raison : il nomme la plateforme de l'archive, et une archive macOS qui prétendrait tourner sous Windows serait un mensonge à la première ligne. Le générer permet aussi de **tester son contenu** — en particulier la phrase qui autorise à éteindre.

- [ ] **Step 1: Écrire le test qui échoue**

`src/distribution/lisezmoi.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { texteLisezmoi } from '../../outils/lib/lisezmoi.mjs'

const texte = texteLisezmoi({ plateforme: 'macOS Apple Silicon', version: '1.0.0' })

// Le corps du LISEZMOI est volontairement sans accent : un .txt ouvert dans le
// Bloc-notes Windows en encodage local afficherait sinon des caracteres abimes.
// Les fragments cherches ici sont donc ceux du texte reel, sans accent.
describe('LISEZMOI', () => {
  it('dit noir sur blanc que l arrêt ne perd rien', () => {
    // C'est la phrase du lot. Sans elle, on n'ose pas éteindre, et une
    // application qu'on n'ose pas éteindre est inutilisable.
    expect(texte).toContain('ne perd aucune donnee')
    expect(texte).toContain('a chaque saisie validee')
  })

  it('commence par le prérequis Node, avec la commande pour le vérifier', () => {
    const avantDemarrer = texte.slice(0, texte.indexOf('./demarrer.sh'))
    expect(avantDemarrer).toContain('Node.js 20')
    expect(avantDemarrer).toContain('node -v')
  })

  it('suit l ordre des questions qu on se pose après avoir dézippé', () => {
    const positions = [
      texte.indexOf('node -v'),
      texte.indexOf('./demarrer.sh'),
      texte.indexOf('./arreter.sh'),
      texte.indexOf('dossier donnees/'),
      texte.indexOf('ne perd aucune donnee'),
      texte.indexOf('METTRE A JOUR'),
      texte.indexOf("SI LE NAVIGATEUR NE S'OUVRE PAS"),
    ]
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('dit que copier donnees/ suffit à tout sauvegarder', () => {
    expect(texte).toMatch(/copier[^.]*donnees[^.]*sauvegarder/i)
  })

  it('donne les quatre étapes de mise à jour, dans l ordre', () => {
    const maj = texte.slice(texte.indexOf('METTRE A JOUR'))
    const etapes = ['1. ./arreter.sh', '2. dezippe', '3. copie', '4. ./demarrer.sh']
    let curseur = -1
    for (const e of etapes) {
      const p = maj.indexOf(e)
      expect(p, `étape « ${e} » absente ou dans le désordre`).toBeGreaterThan(curseur)
      curseur = p
    }
    expect(maj).toContain('dossier neuf')
  })

  it('affirme que l archive ne contient pas donnees/', () => {
    expect(texte).toContain("L'archive ne contient jamais de dossier donnees/")
  })

  it('nomme la plateforme de cette archive-ci', () => {
    expect(texte).toContain('macOS Apple Silicon')
    expect(texteLisezmoi({ plateforme: 'Windows x64', version: '1.0.0' })).toContain('Windows x64')
  })

  it('donne les commandes Windows à côté des commandes POSIX', () => {
    expect(texte).toContain('demarrer.cmd')
    expect(texte).toContain('arreter.cmd')
  })

  it('tient sur un écran', () => {
    // La spec le demande. Au-delà de 80 lignes, plus personne ne le lit.
    expect(texte.split('\n').length).toBeLessThanOrEqual(80)
  })
})
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run src/distribution/lisezmoi.test.ts`
Expected: FAIL — `Failed to resolve import "../../outils/lib/lisezmoi.mjs"`

- [ ] **Step 3: Écrire `outils/lib/lisezmoi.mjs`**

```js
/**
 * Texte du LISEZMOI livré à la racine de l'archive.
 *
 * Généré plutôt que recopié : il nomme la plateforme de l'archive, et son
 * contenu est vérifié par `src/distribution/lisezmoi.test.ts` — notamment la
 * phrase sur la durabilité, qui est la raison d'être de ce lot.
 */
export function texteLisezmoi({ plateforme, version }) {
  return `CRA ${version} — version portable pour ${plateforme}
==================================================================

Compte-rendu d'activite, a faire tourner sur ton ordinateur.
Cette archive est prevue pour ${plateforme} uniquement.


1. CE QU'IL FAUT AVOIR
----------------------
Node.js 20 ou plus. Pour verifier, ouvre un terminal et tape :

    node -v

Si la reponse commence par v20, v22 ou plus, tout va bien.
Sinon, installe Node.js depuis https://nodejs.org


2. DEMARRER
-----------
    ./demarrer.sh            (macOS, Linux)
    demarrer.cmd             (Windows)

Le navigateur s'ouvre tout seul. Au tout premier demarrage, l'application
te demande de creer un compte :

    ./creer-utilisateur.sh moi@exemple.fr "Mon Nom" monmotdepasse


3. ARRETER
----------
    ./arreter.sh             (macOS, Linux)
    arreter.cmd              (Windows)


4. OU SONT TES DONNEES
----------------------
Tout est dans le dossier donnees/, a cote de ce fichier.
Copier donnees/ ailleurs, c'est tout sauvegarder.

Pour une copie propre pendant que l'application tourne :

    ./sauvegarder.sh         (sauvegarder.cmd sous Windows)


5. ARRETER NE PERD RIEN
-----------------------
L'application ne perd aucune donnee quand tu l'arretes. Elle ecrit sur le
disque a chaque saisie validee, en journalisation WAL. Fermer la fenetre,
arreter le programme ou couper l'ordinateur ne fait perdre aucune saisie
deja enregistree. Tu peux eteindre sans y penser.


6. METTRE A JOUR
----------------
    1. ./arreter.sh
    2. dezippe la nouvelle archive dans un dossier neuf
    3. copie ton dossier donnees/ dans ce dossier neuf
    4. ./demarrer.sh — la base se met a jour toute seule

L'archive ne contient jamais de dossier donnees/ : meme en dezippant par
dessus ton installation actuelle, rien ne peut ecraser ta base. Avant
d'appliquer une mise a jour de la base, une copie de sauvegarde est ecrite
automatiquement dans donnees/sauvegardes/.


7. SI LE NAVIGATEUR NE S'OUVRE PAS
----------------------------------
L'adresse est affichee dans le terminal au demarrage, sous la forme
http://127.0.0.1:3000 — saisis-la a la main dans ton navigateur. Le
numero peut differer si le 3000 etait deja pris : c'est normal, et
l'adresse exacte est toujours celle affichee.

En cas de blocage, le journal du demarrage est dans donnees/journal.log
`
}
```

Le corps est **sans accent**, délibérément : un `LISEZMOI.txt` ouvert dans le Bloc-notes Windows en encodage local afficherait sinon des caractères abîmés. Les assertions de la tâche portent donc sur ces chaînes-là. Le gabarit fait 74 lignes, sous le plafond de 80 posé par le test.

- [ ] **Step 4: Lancer**

Run: `npx vitest run src/distribution/lisezmoi.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Vérifier par mutation**

Retirer temporairement le paragraphe 5 du `LISEZMOI`, relancer : le test « dit noir sur blanc que l'arrêt ne perd rien » **et** celui sur l'ordre des sections doivent échouer. Restaurer.

- [ ] **Step 6: Commit**

```bash
git add outils/lib/lisezmoi.mjs src/distribution/lisezmoi.test.ts
git commit -m "feat(portable): generated readme, with its promises under test"
```

---

## Task 9: Empaquetage — et la propriété centrale : l'archive sans `donnees/`

**Files:** Create `outils/lib/paquet.mjs`, `scripts/empaqueter.mjs`, `src/distribution/paquet.test.ts`. Modify `next.config.ts`, `package.json`, `.gitignore`, `.dockerignore`

**Interfaces:**
- Consumes: tout ce qui précède
- Produces:
  - `estExclu(cheminRelatif: string): boolean`
  - `listerFichiersDuPaquet(racine: string): string[]` — chemins relatifs POSIX, triés
  - `npm run empaqueter` → `distribution/cra-<version>-<plateforme>.zip`

**C'est ici que se joue le lot.** L'archive qui ne contient pas `donnees/` est ce qui rend l'écrasement accidentel impossible ; le test qui le prouve est le plus important de tout le plan.

- [ ] **Step 1: Écrire le test qui échoue — le test central d'abord**

`src/distribution/paquet.test.ts` :

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { estExclu, listerFichiersDuPaquet } from '../../outils/lib/paquet.mjs'

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

describe("l'archive ne contient jamais donnees/", () => {
  it("exclut donnees/ et tout ce qu'il contient", () => {
    // LE test du lot. Tant qu'il passe, dezipper la nouvelle version par
    // dessus l'ancienne ne peut pas ecraser la base : il n'y a simplement
    // rien dans l'archive qui puisse la remplacer.
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
    // `donneesDeTest.md` n'est pas le dossier de donnees : l'exclusion doit
    // porter sur un segment de chemin entier, pas sur un prefixe.
    poser('app/donneesDeTest.md')
    expect(listerFichiersDuPaquet(bac)).toEqual(['app/donneesDeTest.md'])
  })
})

describe('autres exclusions', () => {
  it("exclut le .env que Next recopie dans la sortie standalone", () => {
    // Mesure avant ce lot : .next/standalone/.env contenait
    // AUTH_SECRET="dev-secret-non-production". Le livrer serait diffuser un
    // secret de developpement a tous les utilisateurs.
    poser('app/.env', 'AUTH_SECRET="dev-secret-non-production"')
    poser('app/.env.local')
    poser('app/server.js')
    expect(listerFichiersDuPaquet(bac)).toEqual(['app/server.js'])
  })

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
```

- [ ] **Step 2: Lancer pour vérifier l'échec**

Run: `npx vitest run src/distribution/paquet.test.ts`
Expected: FAIL — `Failed to resolve import "../../outils/lib/paquet.mjs"`

- [ ] **Step 3: Écrire `outils/lib/paquet.mjs`**

```js
import { readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Ce qui ne part jamais dans l'archive.
 *
 * La premiere regle est la propriete de securite du lot : sans `donnees/` dans
 * l'archive, dezipper par dessus une installation existante ne peut pas
 * ecraser la base. Les regles portent sur des SEGMENTS de chemin entiers —
 * `donneesDeTest.md` n'est pas le dossier de donnees.
 */
export const EXCLUSIONS = [
  /(^|\/)donnees(\/|$)/,
  /(^|\/)\.env(\.[^/]*)?$/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.DS_Store$/,
  /(^|\/)[^/]+\.(db|sqlite|sqlite3)(-wal|-shm|-journal)?$/,
]

/** Vrai si ce chemin relatif doit rester hors de l'archive. */
export function estExclu(cheminRelatif) {
  const posix = cheminRelatif.split(path.sep).join('/')
  return EXCLUSIONS.some((r) => r.test(posix))
}

/**
 * Fichiers a mettre dans l'archive, en chemins relatifs POSIX tries.
 * Un dossier exclu n'est meme pas parcouru.
 */
export function listerFichiersDuPaquet(racine) {
  const out = []

  function parcourir(relatif) {
    const abs = relatif === '' ? racine : path.join(racine, relatif)
    for (const entree of readdirSync(abs, { withFileTypes: true })) {
      const suivant = relatif === '' ? entree.name : `${relatif}/${entree.name}`
      if (estExclu(suivant)) continue
      if (entree.isDirectory()) parcourir(suivant)
      else out.push(suivant)
    }
  }

  parcourir('')
  return out.sort()
}
```

- [ ] **Step 4: Lancer pour vérifier le passage**

Run: `npx vitest run src/distribution/paquet.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Vérifier par mutation — c'est ici que ça compte**

Retirer temporairement la première entrée de `EXCLUSIONS` (`/(^|\/)donnees(\/|$)/`), relancer `npx vitest run src/distribution/paquet.test.ts`. **Les deux premiers tests doivent échouer**, en montrant `donnees/cra.db` dans la liste. Restaurer, relancer, vert. Si le test reste vert sans la règle, il ne prouve rien et le lot n'a plus de propriété de sécurité.

- [ ] **Step 6: Rendre le `distDir` paramétrable**

`next.config.ts` :

```ts
import type { NextConfig } from 'next'

// `distDir` est paramétrable pour que l'empaquetage (scripts/empaqueter.mjs)
// construise dans un dossier à part et n'écrase jamais le cache `.next` du
// serveur de développement — piège documenté dans docs/superpowers/ETAT.md §7.
// Sans la variable, rien ne change : ni pour `npm run dev`, ni pour Docker.
const config: NextConfig = {
  output: 'standalone',
  distDir: process.env.CRA_DIST_DIR ?? '.next',
}

export default config
```

Ajouter à `.gitignore` :

```
.next-dist/
distribution/build/
distribution/*.zip
```

Ajouter à `.dockerignore` : `.next-dist` et `distribution` (l'image n'a que faire des artefacts portables).

Ajouter à `package.json`, dans `scripts` : `"empaqueter": "node scripts/empaqueter.mjs"`.

- [ ] **Step 7: Écrire `scripts/empaqueter.mjs`**

```js
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listerFichiersDuPaquet, estExclu } from '../outils/lib/paquet.mjs'
import { texteLisezmoi } from '../outils/lib/lisezmoi.mjs'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = process.env.CRA_DIST_DIR ?? '.next-dist'
const SORTIE = path.join(RACINE, 'distribution')
const CHANTIER = path.join(SORTIE, 'build')
const PAQUET = path.join(CHANTIER, 'cra')

const version = JSON.parse(readFileSync(path.join(RACINE, 'package.json'), 'utf8')).version

/** Plateforme visee et jeton attendu dans le nom du moteur Prisma. */
const PLATEFORMES = {
  'darwin-arm64': { nom: 'macos-apple-silicon', libelle: 'macOS Apple Silicon', jeton: /darwin-arm64/ },
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

// ── 2. Provider SQLite et client Prisma ──────────────────────────────────────
etape('Provider Prisma et generation du client')
const schema = readFileSync(path.join(RACINE, 'prisma/schema.prisma'), 'utf8')
if (!schema.includes('provider = "sqlite"')) {
  execFileSync('node', ['scripts/set-db-provider.mjs', 'sqlite'], { cwd: RACINE, stdio: 'inherit' })
}
execFileSync('npx', ['prisma', 'generate'], { cwd: RACINE, stdio: 'inherit', ...SHELL })

// ── 3. Construction, dans un distDir a part ──────────────────────────────────
etape(`Construction Next dans ${DIST}`)
rmSync(path.join(RACINE, DIST), { recursive: true, force: true })
execFileSync('npx', ['next', 'build'], {
  cwd: RACINE,
  stdio: 'inherit',
  ...SHELL,
  env: { ...process.env, CRA_DIST_DIR: DIST, NODE_ENV: 'production' },
})

const standalone = path.join(RACINE, DIST, 'standalone')
if (!existsSync(path.join(standalone, 'server.js'))) {
  echoue(
    `${path.join(standalone, 'server.js')} est absent.\n` +
      "La sortie standalone n'a pas ete produite dans le distDir attendu.\n" +
      'Repli : arreter le serveur de developpement, relancer avec CRA_DIST_DIR=.next,\n' +
      'puis `rm -rf .next` avant de le redemarrer.',
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
etape('Mise en scene de l archive')
rmSync(CHANTIER, { recursive: true, force: true })
mkdirSync(PAQUET, { recursive: true })

cpSync(standalone, path.join(PAQUET, 'app'), { recursive: true })
cpSync(path.join(RACINE, DIST, 'static'), path.join(PAQUET, 'app', DIST, 'static'), { recursive: true })
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

writeFileSync(
  path.join(PAQUET, 'LISEZMOI.txt'),
  texteLisezmoi({ plateforme: cible.libelle, version }),
)

// ── 6. Purge : tout ce que les regles excluent quitte le chantier ────────────
etape('Purge des fichiers exclus')
const gardes = new Set(listerFichiersDuPaquet(PAQUET))
let purges = 0
function purger(relatif) {
  const abs = relatif === '' ? PAQUET : path.join(PAQUET, relatif)
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const suivant = relatif === '' ? e.name : `${relatif}/${e.name}`
    if (e.isDirectory()) {
      if (estExclu(suivant)) {
        rmSync(path.join(PAQUET, suivant), { recursive: true, force: true })
        purges++
      } else purger(suivant)
    } else if (!gardes.has(suivant)) {
      rmSync(path.join(PAQUET, suivant), { force: true })
      purges++
    }
  }
}
purger('')
console.log(`${purges} entree(s) purgee(s) — dont le .env recopie par Next dans la sortie standalone.`)

// ── 7. Archive ───────────────────────────────────────────────────────────────
etape('Creation de l archive')
const nomArchive = `cra-${version}-${cible.nom}.zip`
const archive = path.join(SORTIE, nomArchive)
rmSync(archive, { force: true })

if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `Compress-Archive -Path '${PAQUET}' -DestinationPath '${archive}'`],
    { stdio: 'inherit' },
  )
} else {
  // -X : pas d'attributs etendus (dont la quarantaine macOS). -r : recursif.
  execFileSync('zip', ['-q', '-r', '-X', archive, 'cra'], { cwd: CHANTIER, stdio: 'inherit' })
}

// ── 8. Auto-controle de l'archive produite ───────────────────────────────────
etape('Auto-controle')
const entrees =
  process.platform === 'win32'
    ? execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `Add-Type -A System.IO.Compression.FileSystem; ` +
          `[IO.Compression.ZipFile]::OpenRead('${archive}').Entries | ForEach-Object { $_.FullName }`,
      ]).toString().split(/\r?\n/)
    : execFileSync('unzip', ['-Z1', archive]).toString().split('\n')

const liste = entrees.map((e) => e.trim().replace(/\\/g, '/')).filter(Boolean)

const interdits = liste.filter((e) => /(^|\/)donnees(\/|$)/.test(e) || /(^|\/)\.env(\.|$)/.test(e))
if (interdits.length > 0) {
  echoue(
    "L'archive contient des entrees interdites :\n  " +
      interdits.join('\n  ') +
      "\n\nC'est la propriete de securite du lot : sans donnees/ dans l'archive, dezipper\n" +
      "par dessus une installation existante ne peut pas ecraser la base.",
  )
}

const attendus = [
  'cra/LISEZMOI.txt',
  'cra/demarrer.sh',
  'cra/arreter.sh',
  'cra/sauvegarder.sh',
  'cra/creer-utilisateur.sh',
  'cra/demarrer.cmd',
  'cra/app/server.js',
  'cra/app/outils/lancer.mjs',
]
const manquants = attendus.filter((a) => !liste.includes(a))
const parPrefixe = [
  ['cra/app/node_modules/@prisma/client/', 'le client Prisma'],
  ['cra/app/node_modules/@node-rs/argon2', 'argon2 (creation d utilisateur)'],
  ['cra/app/node_modules/.prisma/client/', 'le moteur Prisma natif'],
  [`cra/app/${DIST}/static/`, 'les fichiers statiques (CSS compris)'],
  ['cra/app/prisma/migrations-sqlite/', 'les migrations SQLite'],
]
for (const [prefixe, quoi] of parPrefixe) {
  if (!liste.some((e) => e.startsWith(prefixe))) manquants.push(`${prefixe} (${quoi})`)
}
if (manquants.length > 0) {
  echoue("L'archive est incomplete, il manque :\n  " + manquants.join('\n  '))
}

console.log('')
console.log(`Archive : ${archive}`)
console.log(`Entrees : ${liste.length}`)
console.log("Aucune entree donnees/, aucun .env : dezipper par dessus n'ecrase aucune base.")
console.log('')
```

- [ ] **Step 8: Empaqueter pour de vrai**

**Prérequis :** aucun serveur de développement en cours sur cet arbre. Le vérifier :

```bash
ps -ax -o pid,command | grep -i "next dev" | grep -v grep || echo "aucun serveur de developpement"
```

Puis :

```bash
npm run empaqueter
```

Expected: les huit étapes s'enchaînent, la dernière affichant `Archive : .../distribution/cra-1.0.0-macos-apple-silicon.zip` et la ligne « Aucune entrée donnees/, aucun .env ».

En cas d'échec sur l'étape 3 (sortie standalone absente du `distDir`), appliquer le repli documenté dans le message d'erreur et **le consigner ici même dans le plan**, comme écart avéré.

**Puis vérifier que la construction n'a rien sali dans le dépôt :**

```bash
git status --short
git diff tsconfig.json next-env.d.ts
```

`next build` réécrit `tsconfig.json` pour y ajouter `<distDir>/types/**/*.ts` dans `include`. Avec un `distDir` inhabituel, cela ajoute une entrée `.next-dist/types/**/*.ts` qui n'a rien à faire dans le dépôt : **la retirer** (`git checkout -- tsconfig.json`) et conserver la seule entrée `.next/types/**/*.ts`. Même contrôle pour `next-env.d.ts`. Le seul état attendu après empaquetage, hors fichiers ignorés, est un dépôt propre.

- [ ] **Step 9: Vérifier l'archive à la main, indépendamment du script**

```bash
ARCHIVE=distribution/cra-1.0.0-macos-apple-silicon.zip
unzip -Z1 "$ARCHIVE" | grep -c . 
echo "entrees donnees/ : $(unzip -Z1 "$ARCHIVE" | grep -c 'donnees' || true)"
echo "entrees .env     : $(unzip -Z1 "$ARCHIVE" | grep -cE '(^|/)\.env' || true)"
unzip -Z1 "$ARCHIVE" | grep -E 'libquery_engine|argon2.*\.node' 
du -h "$ARCHIVE"
```

Expected: `entrees donnees/ : 0`, `entrees .env : 0`, au moins un `libquery_engine-darwin-arm64.dylib.node` et un binaire argon2, et une taille de l'ordre de quelques dizaines de mégaoctets.

- [ ] **Step 10: Vérifier la suite complète**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0.

- [ ] **Step 11: Commit**

```bash
git add outils/lib/paquet.mjs scripts/empaqueter.mjs src/distribution/paquet.test.ts \
        next.config.ts package.json .gitignore .dockerignore
git commit -m "feat(portable): archive packaging that proves it carries no donnees/ folder"
```

---

## Task 10: Recette d'exploitation exécutée ici, documentation, et ce qui restera non vérifié

**Files:** Modify `README.md`, `docs/superpowers/ETAT.md`

Cette tâche n'écrit presque pas de code : elle **exerce** ce qui a été construit, depuis l'archive dézippée hors du dépôt, puis consigne honnêtement la frontière du vérifiable.

- [ ] **Step 1: Dézipper hors du dépôt et démarrer**

Trois variables et une fonction tiennent toute la recette ; les reposer au début de chaque terminal :

```bash
DEPOT=$(git rev-parse --show-toplevel)
BAC=$(mktemp -d)/recette
ARCHIVE="$DEPOT/distribution/cra-1.0.0-macos-apple-silicon.zip"

# Interroge une base avec le client Prisma EMBARQUE dans l'archive, jamais celui
# du dépôt : la question posée est « l'archive fonctionne-t-elle ? ».
# On se place dans app/ pour que le specifier `@prisma/client` se résolve dans
# app/node_modules — le paquet embarqué n'expose que `default.js`, pas
# `index.js`, donc un chemin de fichier direct ne marcherait pas.
interroger() { (cd "$1/app" && DATABASE_URL="$2" node --input-type=module -e "$(cat)"); }
```

```bash
rm -rf "$BAC" && mkdir -p "$BAC"
unzip -q "$ARCHIVE" -d "$BAC"
ls -la "$BAC/cra"
cd "$BAC/cra" && ./demarrer.sh
```

Expected: `donnees/` **absent** du listing juste après dézippage ; puis le démarrage crée `donnees/`, applique la migration initiale, annonce `CRA est démarré : http://127.0.0.1:3000`, et — puisqu'aucun utilisateur n'existe — affiche la commande `./creer-utilisateur.sh` **sans** ouvrir le navigateur.

- [ ] **Step 2: Vérifier que l'application répond réellement**

```bash
cd "$BAC/cra"
PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('donnees/cra.pid','utf8')).port)")
curl -s -o /dev/null -w "login: %{http_code}\n" "http://127.0.0.1:$PORT/login"
curl -s "http://127.0.0.1:$PORT/login" | grep -c "Connexion" || true
curl -s -o /dev/null -w "saisie sans session: %{http_code}\n" "http://127.0.0.1:$PORT/saisie/2026-08"
CSS=$(curl -s "http://127.0.0.1:$PORT/login" | grep -o '/_next/static/css/[^"]*\.css' | head -1)
curl -s "http://127.0.0.1:$PORT$CSS" | head -c 200
```

Expected: `login: 200` — ce qui **prouve en même temps** que `AUTH_TRUST_HOST` est bien posé (sans lui, Auth.js répond une erreur d'hôte non fiable) et que le moteur Prisma natif s'est chargé. `/saisie/2026-08` sans session doit renvoyer une redirection (`307`/`302`) vers `/login`. La feuille de style doit rendre de vraies règles compilées (et non un fichier vide) : c'est ce qui atteste que `app/.next-dist/static/` a bien été embarqué et est servi.

- [ ] **Step 3: Créer un utilisateur et vérifier la journalisation WAL**

```bash
cd "$BAC/cra"
./creer-utilisateur.sh recette@exemple.fr "Recette" motdepasse123
ls -la donnees/
interroger "$BAC/cra" "file:$BAC/cra/donnees/cra.db" <<'JS'
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
console.log('journal_mode =', JSON.stringify(await p.$queryRawUnsafe('PRAGMA journal_mode')))
console.log('utilisateurs =', await p.user.count())
console.log('migrations   =', JSON.stringify(await p.$queryRawUnsafe('SELECT nom FROM "_cra_migrations"')))
await p.$disconnect()
JS
```

Expected: `donnees/` contient `cra.db`, `cra.db-wal`, `cra.db-shm`, `cra.env`, `cra.pid`, `journal.log`, `sauvegardes/`. `journal_mode` vaut `wal`, `utilisateurs` vaut 1, et la migration initiale est journalisée.

- [ ] **Step 4: Sauvegarder pendant que l'application tourne**

```bash
cd "$BAC/cra"
./sauvegarder.sh
COPIE=$(ls -t "$BAC/cra"/donnees/sauvegardes/sauvegarde-*.db | head -1)
interroger "$BAC/cra" "file:$COPIE" <<'JS'
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
console.log('utilisateurs dans la copie =', await p.user.count())
await p.$disconnect()
JS
```

Expected: la copie contient le même utilisateur — un fichier exploitable, pris à chaud.

- [ ] **Step 5: Le port occupé ne bloque pas**

```bash
cd "$BAC/cra"
./arreter.sh
node -e "require('net').createServer().listen(3000,'127.0.0.1',()=>console.log('3000 occupe'))" &
SQUATTEUR=$!
sleep 1
./demarrer.sh
node -e "console.log('port retenu :', JSON.parse(require('fs').readFileSync('donnees/cra.pid','utf8')).port)"
kill $SQUATTEUR
```

Expected: le démarrage réussit et retient `3001`, l'adresse annoncée portant le même numéro.

- [ ] **Step 6: Arrêter deux fois de suite**

```bash
cd "$BAC/cra"
./arreter.sh
./arreter.sh; echo "code de sortie : $?"
ls donnees/cra.pid 2>&1 || echo "pas de fichier PID residuel"
```

Expected: le premier arrête, le second dit calmement « L'application n'est pas démarrée. » avec `code de sortie : 0`. Aucun fichier PID résiduel.

- [ ] **Step 7: Arrêt brutal — aucune écriture validée perdue**

```bash
cd "$BAC/cra"
./demarrer.sh
PID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('donnees/cra.pid','utf8')).pid)")
interroger "$BAC/cra" "file:$BAC/cra/donnees/cra.db" <<'JS'
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
const c = await p.client.create({ data: { name: 'Client avant coupure' } })
console.log('ecrit et valide :', c.id)
await p.$disconnect()
JS
kill -9 "$PID"
rm -f donnees/cra.pid
./demarrer.sh
interroger "$BAC/cra" "file:$BAC/cra/donnees/cra.db" <<'JS'
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
console.log('retrouve apres SIGKILL :', (await p.client.findMany()).map((c) => c.name))
await p.$disconnect()
JS
```

Expected: `Client avant coupure` est retrouvé. C'est la preuve, sur cette installation, de la phrase du `LISEZMOI`.

- [ ] **Step 8: Dézipper par-dessus n'écrase aucune base**

```bash
cd "$BAC/cra" && ./arreter.sh
EMPREINTE_AVANT=$(shasum -a 256 "$BAC/cra/donnees/cra.db" | cut -d' ' -f1)
unzip -o -q "$ARCHIVE" -d "$BAC"
EMPREINTE_APRES=$(shasum -a 256 "$BAC/cra/donnees/cra.db" | cut -d' ' -f1)
[ "$EMPREINTE_AVANT" = "$EMPREINTE_APRES" ] && echo "BASE INTACTE" || echo "ECHEC : la base a change"
```

Expected: `BASE INTACTE`. L'archive n'a rien à mettre à la place.

- [ ] **Step 9: Mise à jour avec migration, sur une base créée par la version précédente**

```bash
cd "$DEPOT"
mkdir -p prisma/migrations-sqlite/20260817000000_recette
cat > prisma/migrations-sqlite/20260817000000_recette/migration.sql <<'SQL'
-- Migration de recette : verifie le chemin de mise a jour de bout en bout.
ALTER TABLE "Settings" ADD COLUMN "champRecette" TEXT;
SQL
npm run empaqueter

rm -rf "$BAC/v2" && mkdir -p "$BAC/v2"
unzip -q "$ARCHIVE" -d "$BAC/v2"
cp -R "$BAC/cra/donnees" "$BAC/v2/cra/donnees"
cd "$BAC/v2/cra" && ./demarrer.sh
ls -la donnees/sauvegardes/avant-migration-*.db
interroger "$BAC/v2/cra" "file:$BAC/v2/cra/donnees/cra.db" <<'JS'
import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
console.log('migrations :', JSON.stringify(await p.$queryRawUnsafe('SELECT nom FROM "_cra_migrations"')))
console.log('utilisateurs conserves :', await p.user.count())
await p.$disconnect()
JS
./arreter.sh
```

Expected: le démarrage annonce « Copie de sauvegarde écrite avant migration : … », un fichier `avant-migration-*.db` existe, les deux migrations sont journalisées, et l'utilisateur créé avant la mise à jour est toujours là.

**Puis retirer la migration de recette et reconstruire l'archive définitive :**

```bash
cd "$DEPOT"
rm -rf prisma/migrations-sqlite/20260817000000_recette
npx vitest run src/distribution/migrations-sqlite.test.ts
npm run empaqueter
git status --short
```

*(Le garde-fou doit repasser au vert : `champRecette` n'existe pas dans `schema.prisma`, donc son retrait ne laisse aucune colonne manquante.)*

- [ ] **Step 10: Exercer le nettoyage de quarantaine macOS**

```bash
cd "$BAC/cra"
xattr -w com.apple.quarantine "0081;00000000;Safari;" app/node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node
xattr -l app/node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node
./demarrer.sh
xattr -l app/node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node || echo "quarantaine levee"
./arreter.sh
```

Expected: l'attribut est posé, puis absent après `./demarrer.sh`, et le démarrage aboutit. *(Ce n'est pas identique à une archive réellement téléchargée par un navigateur — voir le tableau ci-dessous.)*

- [ ] **Step 11: Nettoyer le bac de recette**

```bash
rm -rf $(mktemp -d)/recette
```

- [ ] **Step 12: Écrire la section « Poste local, archive portable » du README**

Remplacer, dans `README.md`, la ligne du tableau `| Poste local, double-clic | Tauri — hors périmètre de ce lot | SQLite |` par
`| Poste local, archive | archive portable par plateforme (lot 5) | SQLite (fichier) |`,
et ajouter après la section « Poste local (sans Docker, SQLite) » le bloc ci-dessous (délimité ici par quatre accents graves parce qu'il contient lui-même des blocs de code) :

````markdown
## Archive portable (lot 5)

Pour distribuer l'application à quelqu'un qui ne veut ni dépôt, ni Docker,
ni `npm install`.

```bash
npm run empaqueter
```

Produit `distribution/cra-<version>-<plateforme>.zip`, **construit dans un
`distDir` séparé** (`CRA_DIST_DIR`, `.next-dist` par défaut) pour ne jamais
écraser le cache `.next` du serveur de développement.

**Une archive par plateforme, jamais d'archive universelle.** Les moteurs
Prisma sont compilés par architecture ; `scripts/empaqueter.mjs` refuse de
produire une archive dont le moteur embarqué ne correspond pas à la machine
qui construit. Pour les quatre cibles (macOS Apple Silicon, macOS Intel,
Windows x64, Linux x64), lancer `npm run empaqueter` **sur** chacune.

Ce que le script garantit avant de rendre la main, en rouvrant l'archive
produite :

- aucune entrée `donnees/` — c'est ce qui rend l'écrasement accidentel
  impossible, même en dézippant par-dessus une installation existante ;
- aucun fichier `.env` — Next recopie le `.env` du dépôt dans la sortie
  standalone, secret de développement compris ;
- présence du client et du moteur Prisma, d'argon2, des fichiers statiques
  et du jeu de migrations SQLite.

**Migrations du mode portable.** L'archive ne contient pas le CLI Prisma :
`outils/lib/migrations.mjs` rejoue les fichiers de
`prisma/migrations-sqlite/` et tient son journal dans la table
`_cra_migrations`. Toute évolution de `prisma/schema.prisma` doit donc être
accompagnée **de deux migrations** : une Postgres sous `prisma/migrations/`
et une SQLite sous `prisma/migrations-sqlite/`, générées hors ligne :

```bash
npx prisma migrate diff --from-migrations prisma/migrations-sqlite \
  --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations-sqlite/<AAAAMMJJHHMMSS>_<nom>/migration.sql
```

`npx vitest run` échoue en nommant la colonne manquante si l'un des deux
jeux prend du retard (`src/db/schema-migration-sync.test.ts` et
`src/distribution/migrations-sqlite.test.ts`).
````

- [ ] **Step 13: Consigner la frontière du vérifiable — dans le README, section « État vérifié »**

Ajouter à `README.md`, à la suite de la section « État vérifié de ce lot » :

````markdown
### Lot 5 — ce qui a été exercé, et ce qui ne pouvait pas l'être

Exercé réellement ici, sur l'archive dézippée hors du dépôt :
démarrage et création de la base, journalisation `wal` relue par pragma,
`/login` en 200 (ce qui prouve du même coup `AUTH_TRUST_HOST`, le CSS et le
chargement du moteur natif), création d'utilisateur, sauvegarde à chaud
relue, port 3000 occupé donnant 3001, double `arreter` sans erreur,
`kill -9` sans perte d'écriture validée, dézippage par-dessus laissant
l'empreinte SHA-256 de la base inchangée, mise à jour avec migration
précédée de sa copie de sauvegarde, refus propre d'un Node 18 simulé.

**Non vérifiable dans cet environnement :**

| Point | Pourquoi | Vérification la plus proche, effectuée |
|---|---|---|
| Machine vierge, sans le dépôt ni aucune dépendance | Une seule machine ici, qui héberge le dépôt | Archive dézippée hors du dépôt, exécutée depuis ce dossier seul ; aucune résolution ne sort de `cra/app/node_modules` |
| Archives macOS Intel, Windows x64, Linux x64 | Ni ces machines ni ces moteurs Prisma ici | `scripts/empaqueter.mjs` refuse toute archive dont le moteur ne correspond pas à la machine qui construit, et nomme l'archive d'après elle |
| Exécution des scripts `.cmd` sous Windows | Pas de `cmd.exe` | Test de parité `.sh`/`.cmd` : même outil appelé, même seuil Node 20 avant l'appel, CRLF, `CRA_RACINE` |
| Gatekeeper sur une archive réellement téléchargée | Pas de passage par un navigateur | Attribut `com.apple.quarantine` posé à la main, puis levé par `demarrer.sh` |
| Docker et Postgres | Jamais exécutés ici, inchangé depuis le lot 0 | Le jeu Postgres et son garde-fou statique restent verts et n'ont pas été touchés |
| Durabilité après coupure de courant réelle | Pas de coupure provocable | `kill -9` pendant l'écriture, en WAL |
| Volume réel (des années de CRA) | Pas de base de cette taille | `VACUUM INTO` mesuré sur la base de développement (135 Ko) |
````

- [ ] **Step 14: Mettre `ETAT.md` à jour**

Dans `docs/superpowers/ETAT.md` :

- §5, tableau « Ce qui reste » : passer la ligne du lot 5 à `| **5** — Distribution portable | oui | **oui** | 10 |`.
- §8, dettes connues : ajouter
  `- **Chaque évolution de schéma demande désormais deux migrations** — une Postgres, une SQLite. Les deux garde-fous statiques échouent si l'une prend du retard, mais l'oubli reste facile.`
  et
  `- **L'archive portable n'a été construite et éprouvée que pour macOS Apple Silicon.** Les trois autres plateformes demandent un passage sur la machine correspondante.`
- §7, pièges : ajouter
  `- **L'empaquetage construit dans \`CRA_DIST_DIR\` (\`.next-dist\`), jamais dans \`.next\`** — c'est ce qui permet de construire sans écraser le cache du serveur de développement.`

- [ ] **Step 15: Vérification finale**

Run: `npx vitest run && npx tsc --noEmit`
Expected: tout vert, `tsc` à 0, et **62 tests de plus** qu'avant le lot — 5 (tâche 1) + 12 (tâche 2) + 18 (tâche 3) + 8 (tâche 7) + 10 (tâche 8) + 9 (tâche 9). Un écart signale un test perdu à l'extraction de la tâche 1 : le chercher plutôt que d'ajuster le chiffre.

- [ ] **Step 16: Commit**

```bash
git add README.md docs/superpowers/ETAT.md
git commit -m "docs: portable archive, its guarantees and the limits of what was verified"
```

---

## Couverture de la spec

| Exigence de la spec | Tâche |
|---|---|
| §2 — Archive autosuffisante, mise en page `demarrer`/`arreter`/`creer-utilisateur`/`sauvegarder`/`LISEZMOI`/`app/` | 7, 8, 9 |
| §2 — `donnees/` créé au premier démarrage, **jamais dans l'archive** | 4, **9 (test central + auto-contrôle)**, 10 step 8 |
| §2 — Aucune installation de dépendances au dézippage | 9 (auto-contrôle des `node_modules` embarqués), 10 step 1 |
| §2 — Prérequis Node 20, annoncé et contrôlé avant toute chose | 7 (steps 1, 2, 3, 5), 8 |
| §2 — Une archive par plateforme, jamais d'universelle | 9 (contrôle du moteur), 8 (plateforme nommée dans le `LISEZMOI`) |
| §3.1 — Vérifie Node, message clair | 7 step 5 |
| §3.2 — Crée `donnees/` et la base au premier lancement | 2, 4 |
| §3.3 — Applique les migrations en attente ensuite | 2, 10 step 9 |
| §3.4 — Choisit un port libre à partir de 3000 | 3, 10 step 5 |
| §3.5 — Écrit `donnees/cra.pid` | 4 |
| §3.6 — Attend la réponse, ouvre le navigateur, affiche l'adresse | 4, 10 step 2 |
| §3 — Invite à créer un utilisateur s'il n'y en a aucun | 4, 6, 10 step 1 |
| §4 — `arreter` lit le PID, arrête, retire le fichier, ne s'énerve pas si déjà arrêté | 5, 10 step 6 |
| §4 — `LISEZMOI` : arrêter ne perd rien, SQLite écrit à chaque transaction | 8 (test), 10 step 7 |
| §4 — Journalisation WAL | 2 (posée et vérifiée par pragma), 10 step 3 |
| §5 — `sauvegarder` par la commande d'archivage SQLite, à chaud | 2, 6, 10 step 4 |
| §5 — « tout est dans `donnees/`, le copier suffit » | 6, 8 |
| §6 — Les quatre étapes de mise à jour | 8, 10 step 12 |
| §6 — Copie de sauvegarde avant migration | 2, 10 step 9 |
| §7 — `LISEZMOI` sur un écran, dans l'ordre des questions | 8 (tests d'ordre et de longueur) |
| §8 — Les six règles métier | 2, 3, 8, 9 |
| §10 — Les neuf tests de la spec | 9 et 10 (voir tableau ci-dessous) |

### Les tests de la spec §10, un par un

| Test demandé | Où | Statut |
|---|---|---|
| Machine vierge : dézipper, démarrer, se connecter | 10 steps 1-3 | **partiel** — dézippé hors du dépôt, mais pas sur une autre machine |
| `demarrer` sur un Node trop ancien | 7 step 5 | vérifié |
| Port choisi dynamiquement, 3000 occupé | 3 (test), 10 step 5 | vérifié |
| Arrêter puis redémarrer retrouve les mêmes données | 10 steps 5-7 | vérifié |
| Tuer brutalement ne perd aucune écriture validée | 10 step 7 | vérifié |
| Dézipper par-dessus n'écrase aucune base | 9 (test central), 10 step 8 | vérifié |
| Mise à jour avec migration, sauvegarde écrite avant | 2 (test), 10 step 9 | vérifié |
| `sauvegarder` à chaud, restauration exploitable | 2 (test), 10 step 4 | vérifié |
| `arreter` sur une application déjà arrêtée | 5 (test), 10 step 6 | vérifié |

**Hors périmètre, conformément à la spec §9 :** empaquetage natif et signature de code, fonctionnement hors ligne, mise à jour automatique, installateur graphique, Postgres dans l'archive.

## Écarts assumés par rapport à la spec

À contester si le porteur du produit préfère la lettre :

1. **Les sauvegardes vont dans `donnees/sauvegardes/`**, pas « à côté de l'application » (§5). Autrement, « copier `donnees/`, c'est tout sauvegarder » cesserait d'être vrai et la mise à jour laisserait les sauvegardes derrière.
2. **Le navigateur ne s'ouvre pas quand aucun utilisateur n'existe** (§3.6 lu strictement). Une page de connexion sans identifiants est l'impasse que §3 veut précisément éviter.
3. **La spec affirme que « l'application est configurée en journalisation WAL » (§4)** — c'était faux avant ce lot : `PRAGMA journal_mode` valait `delete`. La tâche 2 le corrige et le vérifie plutôt que de reprendre l'affirmation telle quelle.
