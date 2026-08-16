import type { Prisma } from '@prisma/client'
import { ENTITY_TIME_ENTRY, PROVIDER_GOOGLE, type SyncOperation } from '@/core/sync/policy'

/**
 * Au-delà de ce délai, une ligne encore due n'a jamais pu partir : l'agenda
 * n'a jamais été connecté, ou le drainage n'a pas tourné depuis un trimestre.
 */
export const RETENTION_JOURS = 90

/**
 * Borne la file, dans la transaction même qui la fait grossir.
 *
 * La mise en file est inconditionnelle, et c'est voulu : elle est
 * transactionnelle avec l'écriture, et c'est elle qui rend les saisies déjà
 * faites poussables le jour où l'agenda est connecté. Mais sans borne, un
 * utilisateur qui n'active jamais l'agenda accumule une ligne par cellule
 * saisie, que personne ne draine et que rien ne retire.
 *
 * La purge vit ici plutôt que dans le drainage : un compte jamais connecté
 * est précisément celui pour lequel le drainage ne tourne pas. Elle ne peut
 * rien retirer d'exploitable — une ligne due depuis trois mois décrit une
 * intention que l'utilisateur a, depuis, réécrite ou oubliée, et la saisie
 * elle-même reste intacte en base.
 */
async function purgerLignesPerimees(
  tx: Prisma.TransactionClient,
  args: { userId: string; provider: string; now: Date },
): Promise<void> {
  await tx.syncOutbox.deleteMany({
    where: {
      userId: args.userId,
      provider: args.provider,
      nextAttemptAt: { lt: new Date(args.now.getTime() - RETENTION_JOURS * 86_400_000) },
    },
  })
}

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

  await purgerLignesPerimees(tx, { userId: args.userId, provider: args.provider, now })

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
