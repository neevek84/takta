import { prisma } from '@/db/client'
import type { SyncOperation } from '@/core/sync/policy'
import { toIsoDate } from '@/services/time-entries'

export interface FailedSyncRow {
  id: string
  entityId: string
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

  const entries = await prisma.timeEntry.findMany({
    where: { userId, id: { in: rows.map((r) => r.entityId) } },
    include: { line: { include: { mission: { include: { client: true } } } } },
  })
  const parId = new Map(entries.map((e) => [e.id, e]))

  return rows.map((r) => {
    const entry = parId.get(r.entityId)
    return {
      id: r.id,
      entityId: r.entityId,
      operation: r.operation as SyncOperation,
      attempts: r.attempts,
      lastError: r.lastError,
      libelle:
        entry === undefined
          ? 'Saisie supprimée'
          : `${toIsoDate(entry.date)} · ${entry.line.mission.client.name} · ${entry.line.mission.label} · ${entry.line.label}`,
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
