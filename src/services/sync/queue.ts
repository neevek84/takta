import { prisma } from '@/db/client'
import { ENTITY_TIME_ENTRY, type SyncOperation } from '@/core/sync/policy'
import { toIsoDate } from '@/services/time-entries'

export interface FailedSyncRow {
  id: string
  entityId: string
  /** ce que la ligne visait : 'TimeEntry', 'Cra'… */
  entityType: string
  /** vers qui elle partait — l'écran est commun à tous les fournisseurs */
  provider: string
  operation: SyncOperation
  attempts: number
  lastError: string
  /** ce que la ligne visait, pour que l'écran soit lisible */
  libelle: string
}

/**
 * Les lignes tombées en échec, qui **remontent** dans l'écran de
 * synchronisation au lieu de disparaître.
 *
 * Ce module vit à part d'`outbox.ts` pour une raison mécanique : le libellé a
 * besoin de `toIsoDate`, donc de `@/services/time-entries`, qui importe déjà
 * `enqueueTimeEntry` depuis `outbox.ts`. En aval des deux et importé par aucun,
 * `queue.ts` ne ferme aucun cycle.
 */
export async function listFailedSyncRows(userId: string): Promise<FailedSyncRow[]> {
  const rows = await prisma.syncOutbox.findMany({
    where: { userId, state: 'FAILED' },
    orderBy: { updatedAt: 'desc' },
  })
  if (rows.length === 0) return []

  // La recherche est bornée aux lignes qui visent réellement une saisie.
  // Toutes ne le font plus : la file est commune à tous les fournisseurs, et
  // celles qui partent vers Dolibarr désignent un CRA. Chercher leur `cuid`
  // dans `TimeEntry` ne rendait rien, et l'écran les annonçait « Saisie
  // supprimée » — un CRA validé, bien vivant, présenté comme effacé.
  const saisies = rows.filter((r) => r.entityType === ENTITY_TIME_ENTRY)
  const entries =
    saisies.length === 0
      ? []
      : await prisma.timeEntry.findMany({
          where: { userId, id: { in: saisies.map((r) => r.entityId) } },
          include: { line: { include: { mission: { include: { client: true } } } } },
        })
  const parId = new Map(entries.map((e) => [e.id, e]))

  return rows.map((r) => {
    const entry = parId.get(r.entityId)
    return {
      id: r.id,
      entityId: r.entityId,
      entityType: r.entityType,
      provider: r.provider,
      operation: r.operation as SyncOperation,
      attempts: r.attempts,
      lastError: r.lastError,
      libelle:
        entry !== undefined
          ? `${toIsoDate(entry.date)} · ${entry.line.mission.client.name} · ${entry.line.mission.label} · ${entry.line.label}`
          : r.entityType === ENTITY_TIME_ENTRY
            ? 'Saisie supprimée'
            : `${r.entityType} · ${r.entityId}`,
    }
  })
}

/** Remet une ligne en attente immédiate. Rend `false` si elle n'est pas à cet utilisateur. */
export async function retrySyncRow(userId: string, rowId: string): Promise<boolean> {
  const r = await prisma.syncOutbox.updateMany({
    where: { id: rowId, userId },
    data: { state: 'PENDING', attempts: 0, lastError: '', nextAttemptAt: new Date() },
  })
  return r.count > 0
}
