import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'

// La suite tournait sur `prisma/dev.db`, la base de développement. Deux
// conséquences, toutes deux constatées et non supposées :
//
//   1. `admin/theme/actions.test.ts` appelle le vrai `saveTheme`, qui écrit
//      la ligne singleton `Settings`. Lancer les tests réécrivait donc le
//      thème et les réglages réels de l'utilisateur.
//   2. Deux processus vitest concurrents (deux agents, typiquement) se
//      marchaient dessus sur le même fichier SQLite, d'où des échecs non
//      déterministes du genre `expected 420 to be 480`.
//
// Chaque exécution reçoit désormais sa propre base, nommée d'après le PID du
// processus vitest, créée ici et détruite au démontage.
//
// `db push` et non `migrate deploy` : les migrations committées sont écrites
// pour PostgreSQL (`CREATE SCHEMA "public"`) alors que le schéma local est en
// SQLite. Sur une base jetable, projeter le schéma est le bon geste ; la
// dérive des migrations reste couverte par son propre test statique.

export const TEST_DB_PATH = path.resolve(
  __dirname,
  `prisma/test-${process.pid}.db`,
)

export default function setup() {
  const url = `file:${TEST_DB_PATH}`
  execFileSync(
    'npx',
    ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'],
    { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' },
  )

  return () => {
    for (const suffixe of ['', '-journal', '-wal', '-shm']) {
      rmSync(`${TEST_DB_PATH}${suffixe}`, { force: true })
    }
  }
}
