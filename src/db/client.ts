import { PrismaClient } from '@prisma/client'
import { poserDurabiliteSqlite, urlSqliteDurable } from './durabilite'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const url = urlSqliteDurable(process.env.DATABASE_URL ?? '')

export const prisma =
  globalForPrisma.prisma ??
  (url === '' ? new PrismaClient() : new PrismaClient({ datasources: { db: { url } } }))

// Un seul client par processus, en production comme ailleurs. `synchronous` est
// une propriété de connexion : deux clients, c'est deux pools, et un pragma posé
// sur l'un ne dit rien de l'autre. Le rendre global est ce qui fait de « la
// connexion du serveur » une chose qui existe vraiment.
globalForPrisma.prisma = prisma

/**
 * Pose la durabilité SQLite sur la connexion de ce processus.
 * `src/instrumentation.ts` l'appelle au démarrage du serveur, avant que la
 * moindre requête ne soit servie.
 *
 * **Appelée, jamais déclenchée à l'import.** Poser le pragma au chargement du
 * module ouvrirait une connexion pendant `next build`, qui évalue ce fichier :
 * la base de développement du dépôt s'en retrouvait passée en WAL, avec ses
 * fichiers compagnons, par un simple empaquetage. Une construction n'a rien à
 * écrire dans la base de qui la lance.
 */
export function assurerDurabilite(): Promise<void> {
  return poserDurabiliteSqlite(prisma, url)
}
