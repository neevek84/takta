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
import { ouvrirLaTacheDeLaPrestation } from '@/services/dolibarr/taches'
import {
  creerMissionAvecProjet,
  creerProjetDepuisCommande,
  type ProjetVoulu,
} from '@/services/dolibarr/commande'
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

/**
 * Un champ date de formulaire, rendu en `'YYYY-MM-DD'` ou `null`.
 *
 * Un `<input type="date">` vide rend `''`, et un navigateur qui n'en gère pas
 * le type rend ce que l'utilisateur a tapé : tout ce qui n'a pas la forme
 * attendue vaut « pas de date » plutôt qu'une date inventée.
 */
function jourOuNull(valeur: FormDataEntryValue | null): string | null {
  const texte = String(valeur ?? '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(texte) ? texte : null
}

/**
 * Crée une mission à la main, avec le projet Dolibarr demandé — ou sans.
 *
 * Le champ `projet` porte trois valeurs : vide pour aucun projet, `CREER` pour
 * en ouvrir un, ou l'identifiant d'un projet existant. Trois cas, un seul
 * champ : deux commandes séparées auraient laissé l'écran choisir les deux.
 */
export async function addMission(formData: FormData) {
  const user = await requireUser()
  const clientId = String(formData.get('clientId'))
  const label = String(formData.get('label'))
  const choix = String(formData.get('projet') ?? '')

  let projet: ProjetVoulu = { type: 'AUCUN' }
  if (choix === 'CREER') projet = { type: 'CREER' }
  else if (choix !== '') {
    const socidBrut = String(formData.get(`socid-${choix}`) ?? '')
    projet = {
      type: 'EXISTANT',
      projectId: Number(choix),
      projectRef: String(formData.get(`ref-${choix}`) ?? ''),
      projectSocid: socidBrut === '' ? null : Number(socidBrut),
    }
  }

  const commun = {
    clientId,
    label,
    minutesParJour: surchargeOuNull(formData.get('heuresParJour')),
    signataireNom: String(formData.get('signataireNom') ?? ''),
    signataireEmail: String(formData.get('signataireEmail') ?? ''),
    // Le projet Dolibarr en tire son `date_start`. Une commande qui porte une
    // période vendue la fournit ; ici il n'y en a pas, donc on la demande.
    startDate: jourOuNull(formData.get('startDate')),
    userId: user.id,
  }

  // Une mission sans projet ne touche pas au connecteur, et pas seulement
  // parce que c'est inutile : c'est la promesse du produit. L'application
  // s'utilise entière sans Dolibarr, et le chemin ordinaire ne doit pas
  // traverser son service.
  if (projet.type === 'AUCUN') {
    await createMission(commun)
    revalidatePath('/missions')
    return
  }

  let resultat: Awaited<ReturnType<typeof creerMissionAvecProjet>>
  try {
    resultat = await creerMissionAvecProjet({ ...commun, projet, api: await getDolibarrApi() })
  } catch (err) {
    redirect(annonceMission(err instanceof Error ? err.message : String(err), 'danger'))
    return
  }

  revalidatePath('/missions')

  const phrases: string[] = []
  phrases.push(
    resultat.projetCree
      ? `Mission créée, avec le projet « ${resultat.projet?.ref} ».`
      : 'Mission créée et rattachée au projet Dolibarr choisi.',
  )
  redirect(annonceMission(phrases.join(' ')))
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

/**
 * Ajoute une prestation — et **sa tâche Dolibarr**, quand la mission est
 * rattachée à un projet.
 *
 * Sans cela, une prestation née d'une commande recevait sa tâche à l'ouverture
 * du chantier tandis qu'une prestation ajoutée à la main attendait le premier
 * envoi de temps : le projet montrait une partie de ce qui avait été vendu, et
 * le reste surgissait des semaines plus tard.
 *
 * L'échec d'ouverture ne fait jamais échouer l'ajout : la prestation est
 * locale et valide. Il se dit, en revanche — croire sa tâche créée et ne pas
 * la trouver est pire que de savoir qu'elle manque.
 */
export async function addLine(formData: FormData) {
  const user = await requireUser()
  const missionId = String(formData.get('missionId'))
  const label = String(formData.get('label'))

  const ligne = await createLine({
    missionId,
    userId: user.id,
    label,
    soldCentiemes: Math.round(Number(formData.get('joursVendus')) * 100),
    tjmCents: Math.round(Number(formData.get('tjm')) * 100),
    displayUnit: String(formData.get('displayUnit')) as DisplayUnit,
  })

  const { creee, echec } = await ouvrirLaTacheDeLaPrestation({
    userId: user.id,
    missionId,
    lineId: ligne.id,
    label,
    api: await getDolibarrApi(),
  })

  revalidatePath('/missions')
  revalidatePath('/saisie')

  if (echec !== null) {
    redirect(
      annonceMission(
        `Prestation ajoutée, mais sa tâche Dolibarr n'a pas pu être créée (${echec}). ` +
          'Les temps ne partiront pas tant qu’elle manque.',
        'danger',
      ),
    )
  }
  if (creee) {
    redirect(annonceMission(`Prestation ajoutée, avec sa tâche « ${label} » dans le projet.`))
  }
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

  let resultat: Awaited<ReturnType<typeof creerProjetDepuisCommande>>
  try {
    resultat = await creerProjetDepuisCommande({
      userId: user.id,
      orderId,
      // Le client local est déduit du tiers de la commande, et créé s'il
      // n'existe pas : on choisit un tiers Dolibarr dans cet écran, pas un
      // client local.
      cible: { type: 'DEPUIS_LE_TIERS' },
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
  if (resultat.prestationsCreees > 0) {
    phrases.push(
      `${resultat.prestationsCreees} prestation(s) reprises des lignes de service de la commande, ` +
        `avec ${resultat.tachesCreees} tâche(s) créée(s) dans le projet.`,
    )
  }
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
