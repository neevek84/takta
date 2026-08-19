'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { createClient } from '@/services/clients'
import {
  createMission,
  createLine,
  updateLine,
  updateMissionSignataire,
  type SignataireResult,
} from '@/services/missions'
import { getDolibarrApi } from '@/services/dolibarr/resolve'
import { creerProjetDepuisCommande } from '@/services/dolibarr/commande'
import type { DisplayUnit } from '@/core/types'

/**
 * Convertit une saisie en heures (formulaire) en minutes entières pour la
 * surcharge de durée d'une journée. Vide ou aberrant (≤ 0, > 24 h) revient à
 * `null`, c'est-à-dire hérité — le serveur reste la seule barrière qui
 * compte, le `min`/`max` du champ HTML n'empêchant rien.
 */
function surchargeOuNull(brut: FormDataEntryValue | null): number | null {
  const s = String(brut ?? '').trim()
  if (s === '') return null
  const heures = Number(s)
  if (!Number.isFinite(heures) || heures <= 0 || heures > 24) return null
  return Math.round(heures * 60)
}

// L'utilisateur est transmis au service pour que le journal de preuve nomme
// l'auteur réel de l'acte : un acte humain attribué à `SYSTEME` serait une
// preuve fausse. C'est le seul motif de ces deux passages d'argument.
export async function addClient(formData: FormData) {
  const user = await requireUser()
  await createClient(
    String(formData.get('name')),
    surchargeOuNull(formData.get('heuresParJour')),
    user.id,
  )
  revalidatePath('/missions')
}

export async function addMission(formData: FormData) {
  const user = await requireUser()
  await createMission({
    clientId: String(formData.get('clientId')),
    label: String(formData.get('label')),
    minutesParJour: surchargeOuNull(formData.get('heuresParJour')),
    signataireNom: String(formData.get('signataireNom') ?? ''),
    signataireEmail: String(formData.get('signataireEmail') ?? ''),
    userId: user.id,
  })
  revalidatePath('/missions')
}

/** `null` = rien n'a encore été soumis. */
export type SignataireState = SignataireResult | null

/**
 * Enregistre le contact signataire d'une mission, et **rend son verdict**.
 *
 * Le refus doit remonter jusqu'à l'écran : une adresse invalide qui ne
 * s'écrirait pas en silence laisserait l'utilisateur devant un formulaire
 * revenu à l'ancienne valeur, persuadé d'avoir enregistré — et le CRA partirait
 * plus tard chez le mauvais destinataire, ou chez personne.
 *
 * Rien n'est revalidé quand rien n'a été écrit : un refus ne change aucune page.
 */
export async function saveSignataire(
  _prevState: SignataireState,
  formData: FormData,
): Promise<SignataireState> {
  const user = await requireUser()

  const resultat = await updateMissionSignataire(user.id, String(formData.get('missionId')), {
    nom: String(formData.get('signataireNom') ?? ''),
    email: String(formData.get('signataireEmail') ?? ''),
  })
  if (!resultat.ok) return resultat

  revalidatePath('/missions')
  revalidatePath('/cra')
  return resultat
}

/**
 * Un entier, ou `undefined` quand le formulaire ne porte pas le champ.
 *
 * La distinction compte : le formulaire d'une prestation reprise d'une propale
 * ne soumet ni les jours vendus ni le TJM. Les fabriquer quand même enverrait
 * `Math.round(Number(null) * 100)`, c'est-à-dire `NaN` — refusé par la base
 * dans le meilleur des cas, écrit comme un zéro dans le pire.
 */
function entierOuAbsent(brut: FormDataEntryValue | null, facteur: number): number | undefined {
  if (brut === null) return undefined
  const s = String(brut).trim()
  if (s === '') return undefined
  const n = Number(s)
  if (!Number.isFinite(n)) return undefined
  return Math.round(n * facteur)
}

/** `null` = rien n'a encore été soumis. */
export type UpdateLineState = { ok: true } | { ok: false; message: string } | null

/**
 * Modifie une prestation, et **rend son verdict**.
 *
 * Le refus doit remonter jusqu'à l'écran, comme pour le signataire : un
 * formulaire qui se recompose à l'identique laisserait l'utilisateur
 * convaincu d'avoir enregistré.
 *
 * Rien n'est revalidé quand rien n'a été écrit : un refus ne change aucune
 * page.
 */
export async function modifierLigne(
  _prevState: UpdateLineState,
  formData: FormData,
): Promise<UpdateLineState> {
  const user = await requireUser()

  const label = formData.get('label')
  const displayUnit = formData.get('displayUnit')
  const soldCentiemes = entierOuAbsent(formData.get('joursVendus'), 100)
  const tjmCents = entierOuAbsent(formData.get('tjmEuros'), 100)

  const r = await updateLine({
    userId: user.id,
    lineId: String(formData.get('lineId') ?? ''),
    ...(label !== null && { label: String(label) }),
    ...(displayUnit !== null && { displayUnit: String(displayUnit) as DisplayUnit }),
    ...(soldCentiemes !== undefined && { soldCentiemes }),
    ...(tjmCents !== undefined && { tjmCents }),
  })

  if (!r.ok) {
    return {
      ok: false,
      message:
        r.reason === 'ENGAGEMENT_EXTERNE'
          ? r.message
          : 'Cette prestation ne vous est pas affectée.',
    }
  }

  revalidatePath('/missions')
  // La grille de saisie lit les jours vendus, l'unité d'affichage et le
  // libellé de chaque prestation : la laisser sur l'ancienne version afficherait
  // un engagement faux jusqu'au prochain passage.
  revalidatePath('/saisie')
  return { ok: true }
}

export async function addLine(formData: FormData) {
  const user = await requireUser()
  await createLine({
    missionId: String(formData.get('missionId')),
    userId: user.id,
    label: String(formData.get('label')),
    soldCentiemes: Math.round(Number(formData.get('joursVendus')) * 100),
    tjmCents: Math.round(Number(formData.get('tjm')) * 100),
    displayUnit: String(formData.get('displayUnit')) as DisplayUnit,
  })
  revalidatePath('/missions')
  revalidatePath('/saisie')
}

/**
 * Crée une mission à partir d'une commande Dolibarr : le projet naît, porte la
 * référence du bon de commande, et la commande lui est rattachée.
 *
 * Le compte rendu passe par le bandeau, comme sur l'écran d'administration :
 * c'est le seul endroit où le porteur apprendra que le projet existe **malgré**
 * un rattachement de commande en échec. Le taire ferait recommencer — et naître
 * un second projet pour le même bon de commande.
 */
export async function creerMissionDepuisCommande(formData: FormData): Promise<void> {
  const user = await requireUser()
  const api = await getDolibarrApi()
  if (api === null) {
    redirect(annonceMission("Dolibarr n'est pas connecté : aucune mission n'a été créée.", 'danger'))
    return
  }

  const orderId = Number(formData.get('orderId'))
  const clientId = String(formData.get('clientId') ?? '')
  if (clientId === '') {
    redirect(annonceMission('Choisissez le client de la mission à créer.', 'danger'))
    return
  }

  let resultat: Awaited<ReturnType<typeof creerProjetDepuisCommande>>
  try {
    resultat = await creerProjetDepuisCommande({
      userId: user.id,
      orderId,
      cible: { type: 'NOUVELLE_MISSION', clientId },
      api,
    })
  } catch (err) {
    redirect(annonceMission(err instanceof Error ? err.message : String(err), 'danger'))
    return
  }

  const phrases: string[] = [
    resultat.projetExistant
      ? `La commande portait déjà le projet « ${resultat.projet.ref} » : la mission y est rattachée.`
      : `Mission créée, avec le projet « ${resultat.projet.ref} — ${resultat.projet.title} ».`,
  ]
  if (resultat.sansReferenceClient) {
    phrases.push(
      "Cette commande ne porte aucune référence client : le projet a pris la référence de la " +
        'commande. Renseignez « Réf. client » dans Dolibarr si la facture doit la porter.',
    )
  }
  if (resultat.commandeNonRattachee !== null) {
    phrases.push(
      `Le projet existe, mais la commande n'a pas pu y être rattachée (${resultat.commandeNonRattachee}). ` +
        'Rattachez-la dans Dolibarr, sans quoi la facture ne retrouvera pas le bon de commande. ' +
        'Ne relancez pas la création : un second projet naîtrait.',
    )
  }

  revalidatePath('/missions')
  redirect(
    annonceMission(phrases.join(' '), resultat.commandeNonRattachee === null ? 'success' : 'danger'),
  )
}

/** Un message porté par la redirection, avec sa tonalité. */
function annonceMission(message: string, tone: 'success' | 'danger' = 'success'): string {
  return `/missions?message=${encodeURIComponent(message)}&tone=${tone}`
}
