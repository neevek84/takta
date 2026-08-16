'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import type { ConflictResolution } from '@/core/sync/policy'
import { resolveConflict, type ResolveResult } from '@/services/sync/conflicts'
import { flushSyncOutbox, type FlushReport } from '@/services/sync/flush'
import { retrySyncRow } from '@/services/sync/queue'
import { disconnectGoogle } from '@/services/google/connect'

/**
 * Le déclenchement manuel, celui qui rend l'application autoportante : aucun
 * ordonnanceur externe n'est nécessaire pour que la file parte.
 *
 * Il draine le seul compte de la session — pas tous, contrairement à
 * l'endpoint interne : une session ne donne le droit d'écrire que dans son
 * propre agenda.
 */
export async function synchroniserMaintenant(): Promise<FlushReport> {
  const user = await requireUser()
  const r = await flushSyncOutbox({ userId: user.id })
  revalidatePath('/admin/sync')
  return r
}

export async function arbitrer(
  conflictId: string,
  resolution: ConflictResolution,
): Promise<ResolveResult> {
  const user = await requireUser()
  const r = await resolveConflict({ userId: user.id, conflictId, resolution })
  revalidatePath('/admin/sync')
  return r
}

export async function rejouer(rowId: string): Promise<boolean> {
  const user = await requireUser()
  const r = await retrySyncRow(user.id, rowId)
  revalidatePath('/admin/sync')
  return r
}

export async function revoquerGoogle(): Promise<void> {
  const user = await requireUser()
  await disconnectGoogle(user.id)
  revalidatePath('/admin/sync')
}
