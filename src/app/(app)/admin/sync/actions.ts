'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, exigerAdministration } from '@/auth'
import type { ConflictResolution } from '@/core/sync/policy'
import { resolveConflict, type ResolveResult } from '@/services/sync/conflicts'
import { drainProvidersForUser } from '@/services/sync/drain'
import type { DrainReport } from '@/services/sync/flush'
import { retrySyncRow } from '@/services/sync/queue'
import { renvoyerVersAgenda, type RenvoiResult } from '@/services/sync/renvoi'

/**
 * Le déclenchement manuel, celui qui rend l'application autoportante : aucun
 * ordonnanceur externe n'est nécessaire pour que la file parte.
 *
 * Il draine le seul compte de la session — pas tous, contrairement à
 * l'endpoint interne : une session ne donne le droit d'écrire que dans son
 * propre agenda, ni de pousser le CRA d'un autre.
 *
 * `drainProvidersForUser` et non `drainSyncOutbox` : **tous** les fournisseurs.
 * Branché sur le seul drainage de l'agenda, ce bouton laissait un CRA validé
 * s'empiler indéfiniment dans la file Dolibarr, sans erreur ni message.
 *
 * Et un drainage, pas une passe : une seule passe s'arrêterait au lot et
 * rendrait un compte rendu que rien ne distingue d'une file vidée. Un mois
 * rempli sur trois prestations dépasse déjà la taille d'un lot, et ce bouton
 * est le seul écoulement de l'installation nominale.
 */
export async function synchroniserMaintenant(): Promise<DrainReport> {
  const user = await requireUser()
  const r = await drainProvidersForUser({ userId: user.id })
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
  // La session reste exigée — c'est le seul garde-fou tant que les rôles
  // n'existent pas. Mais la ligne n'est plus filtrée sur son propriétaire : la
  // file est de portée instance (arbitrage du 20 août 2026).
  await exigerAdministration()
  const r = await retrySyncRow(rowId)
  revalidatePath('/admin/sync')
  return r
}

/**
 * Remet en file, vers l'agenda, les saisies d'une période.
 *
 * **Sur le compte de la session, jamais sur un compte fourni.** La file
 * d'agenda est personnelle : accepter un identifiant venu du formulaire
 * permettrait de faire écrire dans l'agenda de quelqu'un d'autre.
 */
export async function renvoyerAgenda(du: string, au: string): Promise<RenvoiResult> {
  const user = await requireUser()
  const r = await renvoyerVersAgenda({ userId: user.id, du, au })
  revalidatePath('/admin/sync')
  return r
}
