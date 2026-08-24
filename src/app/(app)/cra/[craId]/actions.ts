'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { transitionCra, updateInvoiceTracking } from '@/services/cra'
import { sendCraForSignature } from '@/services/signature/send'
import { refreshSignatureStatus } from '@/services/signature/refresh'
import type { CraTransition } from '@/core/cra/state-machine'

/**
 * Les motifs d'échec que les services de signature savent rendre, traduits en
 * une phrase. Le motif transite par l'URL parce qu'une server action qui
 * redirige ne rend rien : la page est le seul endroit qui puisse encore parler
 * à l'utilisateur.
 */
export const ERREURS: Record<string, string> = {
  PAS_DE_CONNECTEUR:
    'Aucun outil de signature n’est configuré. Le CRA reste téléchargeable et les transitions manuelles restent disponibles.',
  PAS_DE_SIGNATAIRE:
    'Renseignez le signataire de la mission (nom et adresse électronique) avant d’envoyer le CRA.',
  TRANSITION_IMPOSSIBLE: 'Ce CRA ne peut pas être envoyé dans son état actuel.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas accepté le document. Le CRA n’a pas changé d’état.',
  PAS_DE_DEMANDE: 'Ce CRA n’a jamais été envoyé pour signature.',
}

/**
 * Les server actions de signature ne rendent rien : le motif d'échec repasse
 * par l'URL, et la page le traduit en bandeau. Elle pointe désormais vers le
 * détail — c'est là que l'action a été déclenchée, et c'est là que l'utilisateur
 * doit retrouver son CRA, pas au sommet d'une liste de trente lignes.
 */
function retour(craId: string, raison?: string): never {
  redirect(
    `/cra/${encodeURIComponent(craId)}` +
      (raison === undefined ? '' : `?erreur=${encodeURIComponent(raison)}`),
  )
}

export async function moveCra(formData: FormData) {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  await transitionCra(user.id, craId, String(formData.get('transition')) as CraTransition)
  revalidatePath('/cra')
  revalidatePath(`/cra/${craId}`)
  revalidatePath('/saisie')
}

export async function saveTracking(formData: FormData) {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  const invoicedAt = String(formData.get('invoicedAt'))
  const paidAt = String(formData.get('paidAt'))

  await updateInvoiceTracking(user.id, craId, {
    invoiceNumber: String(formData.get('invoiceNumber')) || null,
    invoicedAt: invoicedAt ? new Date(invoicedAt) : null,
    paidAt: paidAt ? new Date(paidAt) : null,
  })
  revalidatePath('/cra')
  revalidatePath(`/cra/${craId}`)
  revalidatePath('/saisie')
}

export async function envoyerPourSignature(formData: FormData): Promise<void> {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  const r = await sendCraForSignature(user.id, craId)

  revalidatePath('/cra')
  revalidatePath(`/cra/${craId}`)
  revalidatePath('/saisie')
  retour(craId, r.ok ? undefined : r.raison)
}

export async function rafraichirSignature(formData: FormData): Promise<void> {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  const r = await refreshSignatureStatus(user.id, craId)

  revalidatePath('/cra')
  revalidatePath(`/cra/${craId}`)
  revalidatePath('/saisie')
  retour(craId, r.ok ? undefined : r.raison)
}
