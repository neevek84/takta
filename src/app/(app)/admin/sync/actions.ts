'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import type { ConflictResolution } from '@/core/sync/policy'
import { resolveConflict, type ResolveResult } from '@/services/sync/conflicts'
import { drainSyncOutbox, type DrainReport } from '@/services/sync/flush'
import { retrySyncRow } from '@/services/sync/queue'
import { disconnectGoogle } from '@/services/google/connect'

/**
 * Le déclenchement manuel, celui qui rend l'application autoportante : aucun
 * ordonnanceur externe n'est nécessaire pour que la file parte.
 *
 * Il draine le seul compte de la session — pas tous, contrairement à
 * l'endpoint interne : une session ne donne le droit d'écrire que dans son
 * propre agenda.
 *
 * `drainSyncOutbox` et non `flushSyncOutbox` : une seule passe s'arrêterait au
 * lot et rendrait un compte rendu que rien ne distingue d'une file vidée. Un
 * mois rempli sur trois prestations dépasse déjà la taille d'un lot, et ce
 * bouton est le seul écoulement de l'installation nominale.
 */
export async function synchroniserMaintenant(): Promise<DrainReport> {
  const user = await requireUser()
  const r = await drainSyncOutbox({ userId: user.id })
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

/**
 * Déconnecte le compte Google de la session — au sens strict : les jetons
 * stockés ici sont effacés, rien de plus. Elle ne s'appelle pas
 * `revoquerGoogle` : l'autorisation accordée par l'utilisateur reste active
 * côté compte Google (voir `disconnectGoogle`), et un nom de révocation le
 * cacherait. `SyncClient` porte l'explication à l'écran.
 */
export async function deconnecterGoogle(): Promise<void> {
  const user = await requireUser()
  await disconnectGoogle(user.id)
  revalidatePath('/admin/sync')
}
