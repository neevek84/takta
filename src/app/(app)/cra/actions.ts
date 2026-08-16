'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { getOrCreateCra, transitionCra, updateInvoiceTracking } from '@/services/cra'
import { sendCraForSignature } from '@/services/signature/send'
import { refreshSignatureStatus } from '@/services/signature/refresh'
import { runSignatureReminders } from '@/services/signature/reminders'
import type { CraTransition } from '@/core/cra/state-machine'

export async function openCra(formData: FormData) {
  const user = await requireUser()
  await getOrCreateCra(user.id, String(formData.get('missionId')), String(formData.get('month')))
  revalidatePath('/cra')
}

export async function moveCra(formData: FormData) {
  const user = await requireUser()
  await transitionCra(user.id, String(formData.get('craId')), String(formData.get('transition')) as CraTransition)
  revalidatePath('/cra')
  revalidatePath('/saisie')
}

export async function saveTracking(formData: FormData) {
  const user = await requireUser()
  const invoicedAt = String(formData.get('invoicedAt'))
  const paidAt = String(formData.get('paidAt'))

  await updateInvoiceTracking(user.id, String(formData.get('craId')), {
    invoiceNumber: String(formData.get('invoiceNumber')) || null,
    invoicedAt: invoicedAt ? new Date(invoicedAt) : null,
    paidAt: paidAt ? new Date(paidAt) : null,
  })
  revalidatePath('/cra')
}

/**
 * Les server actions de signature ne rendent rien : le motif d'échec repasse
 * par l'URL, et la page le traduit en bandeau. Lever une exception afficherait
 * une page d'erreur là où l'utilisateur a juste besoin d'une phrase.
 */
function retour(month: string, raison?: string): never {
  redirect(
    `/cra?month=${encodeURIComponent(month)}` +
      (raison === undefined ? '' : `&erreur=${encodeURIComponent(raison)}`),
  )
}

export async function envoyerPourSignature(formData: FormData): Promise<void> {
  const user = await requireUser()
  const month = String(formData.get('month'))
  const r = await sendCraForSignature(user.id, String(formData.get('craId')))

  revalidatePath('/cra')
  revalidatePath('/saisie')
  retour(month, r.ok ? undefined : r.raison)
}

export async function rafraichirSignature(formData: FormData): Promise<void> {
  const user = await requireUser()
  const month = String(formData.get('month'))
  const r = await refreshSignatureStatus(user.id, String(formData.get('craId')))

  revalidatePath('/cra')
  revalidatePath('/saisie')
  retour(month, r.ok ? undefined : r.raison)
}

export async function lancerRelances(formData: FormData): Promise<void> {
  const user = await requireUser()
  // Scopé sur l'utilisateur : ce bouton n'est pas l'ordonnanceur, c'est le
  // moyen de s'en passer.
  await runSignatureReminders({ userId: user.id })
  revalidatePath('/cra')
  retour(String(formData.get('month')))
}
