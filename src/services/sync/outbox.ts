import type { Prisma } from '@prisma/client'
import { ENTITY_TIME_ENTRY, PROVIDER_GOOGLE, type SyncOperation } from '@/core/sync/policy'

/**
 * Inscrit une entité dans la file — **toujours dans la transaction d'écriture**.
 *
 * L'upsert sur le triplet est ce qui fait de la file un ensemble : dix
 * modifications d'une même cellule avant le prochain passage produisent une
 * ligne, pas dix. Chaque réécriture repart d'un compteur neuf : une nouvelle
 * intention mérite un nouveau quota de tentatives, et une ligne tombée en
 * `FAILED` redevient éligible dès que l'utilisateur retouche la cellule.
 */
export async function enqueueSync(
  tx: Prisma.TransactionClient,
  args: {
    userId: string
    entityType: string
    entityId: string
    provider: string
    operation: SyncOperation
    now?: Date
  },
): Promise<void> {
  const now = args.now ?? new Date()
  const cible = {
    entityType: args.entityType,
    entityId: args.entityId,
    provider: args.provider,
  }

  await tx.syncOutbox.upsert({
    where: { entityType_entityId_provider: cible },
    create: {
      ...cible,
      userId: args.userId,
      operation: args.operation,
      state: 'PENDING',
      attempts: 0,
      lastError: '',
      nextAttemptAt: now,
    },
    update: {
      operation: args.operation,
      state: 'PENDING',
      attempts: 0,
      lastError: '',
      nextAttemptAt: now,
    },
  })
}

/** La cible unique du lot : une ligne de temps vers Google. */
export async function enqueueTimeEntry(
  tx: Prisma.TransactionClient,
  args: { userId: string; entryId: string; operation: SyncOperation; now?: Date },
): Promise<void> {
  await enqueueSync(tx, {
    userId: args.userId,
    entityType: ENTITY_TIME_ENTRY,
    entityId: args.entryId,
    provider: PROVIDER_GOOGLE,
    operation: args.operation,
    ...(args.now === undefined ? {} : { now: args.now }),
  })
}
