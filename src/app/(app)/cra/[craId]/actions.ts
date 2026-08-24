'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { transitionCra, updateInvoiceTracking } from '@/services/cra'
import { sendCraForSignature } from '@/services/signature/send'
import { refreshSignatureStatus } from '@/services/signature/refresh'
import type { CraTransition } from '@/core/cra/state-machine'

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
