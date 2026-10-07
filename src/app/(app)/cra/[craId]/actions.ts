'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { transitionCra, updateInvoiceTracking } from '@/services/cra'
import { sendCraForSignature } from '@/services/signature/send'
import { refreshSignatureStatus } from '@/services/signature/refresh'
import { annulerEnvoi } from '@/services/signature/annuler'
import { nouveauLienManuel } from '@/services/signature/lien-client'
import type { CraTransition } from '@/core/cra/state-machine'
import { headers } from 'next/headers'
import { originePublique } from '@/core/http/origine'

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

/** L'origine publique de la requête : celle du lien que le client recevra. */
async function origineDeLaRequete(): Promise<string> {
  const entetes = await headers()
  return originePublique(process.env.AUTH_URL, (nom) => entetes.get(nom))
}

export async function envoyerPourSignature(formData: FormData): Promise<void> {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  const r = await sendCraForSignature(user.id, craId, { origine: await origineDeLaRequete() })

  revalidatePath('/cra')
  revalidatePath(`/cra/${craId}`)
  revalidatePath('/saisie')
  retour(craId, r.ok ? (r.courrielEnvoye ? undefined : 'COURRIEL_NON_PARTI') : r.raison)
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

export async function annulerEnvoiAction(formData: FormData): Promise<void> {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  const r = await annulerEnvoi(user.id, craId)
  revalidatePath('/cra')
  revalidatePath(`/cra/${craId}`)
  revalidatePath('/saisie')
  retour(craId, r.ok ? undefined : `ANNULATION_${r.raison}`)
}

export async function copierLienClient(
  _prev: { url: string } | { erreur: string } | null,
  formData: FormData,
): Promise<{ url: string } | { erreur: string }> {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  const r = await nouveauLienManuel(user.id, craId, await origineDeLaRequete())
  return r.ok ? { url: r.url } : { erreur: 'Aucun envoi en attente de signature sur ce CRA.' }
}
