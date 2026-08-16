'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { getOrCreateCra, transitionCra, updateInvoiceTracking } from '@/services/cra'
import { requestCraInvoice } from '@/services/dolibarr/invoicing'
import { getDolibarrApi } from '@/services/dolibarr/resolve'
import type { CraTransition } from '@/core/cra/state-machine'

/**
 * Les tonalités que l'écran sait rendre ; `Banner` en porte le glyphe.
 *
 * Pas exporté : un fichier `'use server'` ne publie que des fonctions
 * asynchrones. La page relit la valeur depuis l'URL et la valide elle-même.
 */
type AnnonceTone = 'success' | 'info' | 'danger'

/**
 * Un message porté par la redirection, avec sa tonalité **et** le mois affiché.
 *
 * La tonalité voyage avec le texte : un refus rendu en vert avec une coche
 * contredirait ce qu'il dit, et la couleur seule ne porte jamais l'information.
 * Le mois voyage avec, sans quoi répondre ramènerait l'utilisateur sur le mois
 * courant — c'est-à-dire ailleurs que sur le CRA dont il vient de parler.
 */
function annonce(month: string, message: string, tone: AnnonceTone): string {
  const params = new URLSearchParams({ month, message, tone })
  return `/cra?${params.toString()}`
}

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
 * Demande à Dolibarr le brouillon de facture d'un CRA validé.
 *
 * **Une proposition, jamais un automatisme** : rien ici n'est appelé par
 * `transitionCra`. Décliner n'a aucune conséquence, et échouer non plus — le
 * CRA reste validé, ses temps restent en file.
 *
 * L'application ne facture pas : elle transmet des quantités et des prix
 * unitaires, et Dolibarr crée le brouillon. Numérotation, TVA, mentions
 * légales, émission et conservation restent entièrement de son côté.
 *
 * Rend toujours la main par une redirection porteuse d'un message : sortir en
 * silence laisserait recliquer sur un bouton qui n'a rien demandé.
 */
export async function demanderFacture(formData: FormData): Promise<void> {
  const user = await requireUser()
  const craId = String(formData.get('craId'))
  const month = String(formData.get('month'))

  const api = await getDolibarrApi()
  if (api === null) {
    redirect(
      annonce(month, 'Dolibarr n’est pas connecté : aucune facture n’a été demandée.', 'danger'),
    )
    return
  }

  const r = await requestCraInvoice({ userId: user.id, craId, api })
  revalidatePath('/cra')

  if (!r.ok) {
    redirect(annonce(month, r.message, 'danger'))
    return
  }
  redirect(
    annonce(
      month,
      r.deja
        ? `La facture de ce CRA a déjà été demandée : brouillon ${r.ref} dans Dolibarr.`
        : `Dolibarr a créé le brouillon de facture ${r.ref}. Vérifiez-le et validez-le dans Dolibarr.`,
      r.deja ? 'info' : 'success',
    ),
  )
}
