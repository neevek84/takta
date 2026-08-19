'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { saveInstanceCredential, revokeInstanceCredential } from '@/services/credentials'
import { baseApiDepuisInstance } from '@/core/dolibarr/url'
import { DOLIBARR } from '@/services/dolibarr/api'
import { createHttpDolibarrApi } from '@/services/dolibarr/http'
import { getDolibarrApi } from '@/services/dolibarr/resolve'
import {
  attachClient,
  attachMission,
  createClientFromDolibarr,
  createMissionFromDolibarr,
  pushClientToDolibarr,
  detachEntity,
  type ImportEntityType,
} from '@/services/dolibarr/import'
import { creerProjetDepuisCommande } from '@/services/dolibarr/commande'
import { rattraperCraValides } from '@/services/dolibarr/rattrapage'
import { applyDolibarrSetup } from '@/services/dolibarr/setup'

const CHEMIN = '/admin/dolibarr'

export type ConnexionState = { ok: true; message: string } | { ok: false; erreurs: string[] } | null

/**
 * Le message d'une erreur, **expurgé de la clé qu'on vient de saisir**.
 *
 * Ce n'est pas de la paranoïa décorative : un client HTTP, une bibliothèque
 * tierce ou un proxy recopient volontiers l'en-tête fautif dans leur message,
 * et ce message-là part droit à l'écran. Une clé affichée une fois est une clé
 * à changer.
 */
function messageSansSecret(err: unknown, secret: string): string {
  const brut = err instanceof Error ? err.message : String(err)
  return secret === '' ? brut : brut.split(secret).join('[clé masquée]')
}

/**
 * Enregistre la clé d'API après l'avoir **essayée** : une clé fausse acceptée
 * en silence ne se manifesterait qu'au premier push, plusieurs jours plus tard,
 * sur un CRA déjà validé.
 *
 * La clé est saisie ici et vit chiffrée en base, en portée instance — jamais
 * dans un fichier d'environnement, et jamais réaffichée.
 */
export async function connecterDolibarr(
  _prev: ConnexionState,
  formData: FormData,
): Promise<ConnexionState> {
  await requireUser()

  const instanceUrl = String(formData.get('instanceUrl') ?? '').trim()
  const apiKey = String(formData.get('apiKey') ?? '').trim()
  const dolibarrUserId = String(formData.get('dolibarrUserId') ?? '').trim()

  const erreurs: string[] = []
  // Le porteur saisit l'adresse de son instance ; `/api/index.php` est le même
  // sur tous les Dolibarr et n'a rien à faire dans une saisie.
  let baseUrl = ''
  try {
    baseUrl = baseApiDepuisInstance(instanceUrl)
  } catch (err) {
    erreurs.push(err instanceof Error ? err.message : String(err))
  }
  if (apiKey === '') erreurs.push("La clé d'API est requise.")
  if (!/^\d+$/.test(dolibarrUserId)) {
    erreurs.push("L'identifiant de l'utilisateur Dolibarr est requis : un temps passé en exige un.")
  }
  if (erreurs.length > 0) return { ok: false, erreurs }

  try {
    // Une instance neuve n'a aucun projet : le client HTTP tolère le 404 que
    // Dolibarr rend sur une collection vide, donc une liste vide vaut succès.
    await createHttpDolibarrApi({ baseUrl, apiKey }).listProjects()
  } catch (err) {
    return { ok: false, erreurs: [messageSansSecret(err, apiKey)] }
  }

  await saveInstanceCredential({
    provider: DOLIBARR,
    secret: apiKey,
    baseUrl,
    metadata: { dolibarrUserId },
  })

  // La connexion est l'un des deux instants où le push s'arme. Tout ce qui a
  // été validé avant elle n'est jamais entré dans la file : sans ce
  // rattrapage, l'historique reste hors de Dolibarr définitivement, et rien à
  // l'écran ne le dit. Le compte est annoncé dans les deux cas — « aucun »
  // est une information, pas un silence.
  const rattrapes = await rattraperCraValides()

  revalidatePath(CHEMIN)
  return {
    ok: true,
    message:
      rattrapes === 0
        ? "Connexion à Dolibarr enregistrée. Aucun CRA validé n'attendait d'être poussé."
        : `Connexion à Dolibarr enregistrée. ${rattrapes} CRA déjà validé(s) ont été mis en file : ` +
          'ils partiront à la prochaine synchronisation.',
  }
}

/**
 * Efface la clé d'API de l'instance. Aucune correspondance n'est rompue : les
 * `ExternalLink` survivent, et reconnecter la même instance les retrouve.
 */
export async function deconnecterDolibarr(): Promise<void> {
  await requireUser()
  await revokeInstanceCredential(DOLIBARR)
  revalidatePath(CHEMIN)
}

export async function rattacherTiers(formData: FormData): Promise<void> {
  const user = await requireUser()
  const dolibarrThirdpartyId = Number(formData.get('dolibarrId'))
  const clientId = String(formData.get('clientId') ?? '')

  if (clientId === '') {
    await createClientFromDolibarr({
      userId: user.id,
      dolibarrThirdpartyId,
      name: String(formData.get('nom') ?? ''),
    })
  } else {
    await attachClient({ userId: user.id, clientId, dolibarrThirdpartyId })
  }
  revalidatePath(CHEMIN)
}

/**
 * Rattache un projet Dolibarr, à une mission existante ou à une mission créée
 * pour l'occasion.
 *
 * Refuse — et le dit à l'écran, pas par une erreur technique — quand le tiers
 * du projet ne correspond pas au tiers déjà rattaché au client de la
 * mission : `attachMission` et `createMissionFromDolibarr` portent le refus,
 * cette action se contente de l'annoncer au lieu de laisser planter la page.
 */
/**
 * Ce qu'un rattachement a fait **au-delà** de la correspondance qu'il pose, ou
 * `null` quand il n'y a rien à dire.
 *
 * Les deux effets annoncés ici ne se devinent pas, et décident tous les deux de
 * ce qui partira chez le client : un repointage rompt les tâches et les temps
 * de l'ancien projet, et un rattachement rattrape les mois validés avant lui.
 * Les taire, c'est le défaut d'origine — un historique hors de Dolibarr, ou des
 * temps qui continuent d'atterrir chez le tiers précédent, sans un mot.
 */
function resumeRattachement(r: {
  repointage: boolean
  lignes: number
  temps: number
  craRattrapes: number
}): string | null {
  const phrases: string[] = []
  if (r.repointage) {
    phrases.push(
      `Projet repointé : ${r.lignes} correspondance(s) de prestation et ${r.temps} de temps ` +
        'consommé ont été rompues. Les temps suivants iront dans le nouveau projet ; ' +
        "ce qui a déjà été poussé reste dans l'ancien.",
    )
  }
  if (r.craRattrapes > 0) {
    phrases.push(
      `${r.craRattrapes} CRA déjà validé(s) ont été mis en file : ils partiront à la ` +
        'prochaine synchronisation.',
    )
  }
  return phrases.length === 0 ? null : phrases.join(' ')
}

export async function rattacherProjet(formData: FormData): Promise<void> {
  const user = await requireUser()
  const dolibarrProjectId = Number(formData.get('dolibarrId'))
  const projectRef = String(formData.get('ref') ?? '')
  const socidBrut = String(formData.get('socid') ?? '')
  const projectSocid = socidBrut === '' ? null : Number(socidBrut)
  const missionId = String(formData.get('missionId') ?? '')

  let resume: string | null = null
  try {
    if (missionId === '') {
      const clientId = String(formData.get('clientId') ?? '')
      // Une mission sans client n'existe pas au modèle : la création échouerait
      // sur la clé étrangère, après avoir laissé croire à un rattachement.
      if (clientId === '') return
      await createMissionFromDolibarr({
        userId: user.id,
        clientId,
        dolibarrProjectId,
        projectRef,
        projectSocid,
        label: String(formData.get('titre') ?? ''),
      })
    } else {
      resume = resumeRattachement(
        await attachMission({
          userId: user.id,
          missionId,
          dolibarrProjectId,
          projectRef,
          projectSocid,
        }),
      )
    }
  } catch (err) {
    redirect(annonce(err instanceof Error ? err.message : String(err), 'danger'))
    return
  }
  revalidatePath(CHEMIN)
  // Un rattachement ordinaire ne dit rien : la page se réaffiche, la
  // correspondance est visible. Seuls les deux effets invisibles s'annoncent.
  if (resume !== null) redirect(annonce(resume))
}

/**
 * Crée le projet Dolibarr d'une commande client, et rattache la mission dessus.
 *
 * Tout ce que l'action rend au porteur passe par le bandeau : c'est le seul
 * endroit où il apprendra que le projet existe **malgré** un rattachement de
 * commande en échec, ou que sa commande ne portait aucune référence client.
 * Les taire ferait recommencer l'opération — et naître un second projet pour
 * le même bon de commande.
 */
export async function creerProjetCommande(formData: FormData): Promise<void> {
  const user = await requireUser()
  const api = await getDolibarrApi()
  if (api === null) {
    redirect(annonce("Dolibarr n'est pas connecté : aucun projet n'a été créé.", 'danger'))
    return
  }

  const orderId = Number(formData.get('orderId'))
  const missionId = String(formData.get('missionId') ?? '')
  const clientId = String(formData.get('clientId') ?? '')

  // Une mission sans client n'existe pas au modèle : la création échouerait sur
  // la clé étrangère, après avoir créé le projet chez Dolibarr.
  if (missionId === '' && clientId === '') {
    redirect(annonce('Choisissez une mission, ou le client de la mission à créer.', 'danger'))
    return
  }

  let resultat: Awaited<ReturnType<typeof creerProjetDepuisCommande>>
  try {
    resultat = await creerProjetDepuisCommande({
      userId: user.id,
      orderId,
      cible: missionId === '' ? { type: 'NOUVELLE_MISSION', clientId } : { type: 'MISSION', missionId },
      api,
    })
  } catch (err) {
    redirect(annonce(err instanceof Error ? err.message : String(err), 'danger'))
    return
  }

  const phrases: string[] = [
    resultat.projetExistant
      ? `La commande portait déjà le projet « ${resultat.projet.ref} » : aucun second projet n'a été créé.`
      : `Projet « ${resultat.projet.ref} — ${resultat.projet.title} » créé.`,
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
        'Ouvrez la commande dans Dolibarr et rattachez-la à ce projet, sans quoi la facture ne ' +
        'retrouvera pas le bon de commande. Ne relancez pas la création : un second projet naîtrait.',
    )
  }
  const suite = resumeRattachement(resultat.rattachement)
  if (suite !== null) phrases.push(suite)

  revalidatePath(CHEMIN)
  redirect(annonce(phrases.join(' '), resultat.commandeNonRattachee === null ? 'success' : 'danger'))
}

export async function detacher(formData: FormData): Promise<void> {
  const user = await requireUser()

  // Le type vient du formulaire, donc de l'extérieur : une valeur forgée
  // effacerait des correspondances d'une tout autre nature.
  const brut = String(formData.get('entityType') ?? '')
  if (brut !== 'Client' && brut !== 'Mission') return
  const entityType: ImportEntityType = brut

  await detachEntity({
    userId: user.id,
    entityType,
    entityId: String(formData.get('entityId') ?? ''),
  })
  revalidatePath(CHEMIN)
}

/**
 * Crée dans Dolibarr le tiers correspondant à un client local.
 *
 * Rend toujours la main par une redirection porteuse d'un message : une action
 * de formulaire qui se contenterait de sortir sur `api === null` laisserait
 * cliquer indéfiniment sur un bouton qui n'a jamais rien poussé — et une panne
 * de Dolibarr passerait pour un succès.
 */
export async function pousserClient(formData: FormData): Promise<void> {
  const user = await requireUser()
  const clientId = String(formData.get('clientId') ?? '')

  const api = await getDolibarrApi()
  if (api === null) {
    redirect(annonce("Dolibarr n'est pas connecté : aucun tiers n'a été créé.", 'danger'))
    return
  }

  let message: string
  let tone: 'success' | 'danger' = 'success'
  try {
    await pushClientToDolibarr({ userId: user.id, clientId, api })
    message = 'Le tiers a été créé dans Dolibarr.'
  } catch (err) {
    // La saisie et la validation des CRA continuent : cet écran est le seul à
    // dépendre de Dolibarr, et il le dit au lieu de tomber.
    message = `Dolibarr n'a pas pu créer le tiers : ${err instanceof Error ? err.message : String(err)}`
    tone = 'danger'
  }

  revalidatePath(CHEMIN)
  redirect(annonce(message, tone))
}

/**
 * Ce que la reprise a fait, en toutes lettres — y compris ce qu'elle **n'a
 * pas** fait.
 *
 * Le nombre de saisies laissées intactes parce qu'elles appartiennent à un CRA
 * validé est la moitié qui compte du message : c'est la promesse du produit,
 * et elle ne vaut que si l'écran la rend vérifiable après coup.
 */
function resumeReprise(r: {
  reglagesRepris: string[]
  recalibrees: number
  sauteesVerrouillees: number
}): string {
  if (r.reglagesRepris.length === 0) {
    return "Aucun réglage n'a été repris de Dolibarr."
  }

  const phrases = [`Réglages repris de Dolibarr : ${r.reglagesRepris.join(', ')}.`]
  if (r.recalibrees > 0) {
    phrases.push(`${r.recalibrees} saisie(s) des mois ouverts ont été réétalonnées.`)
  }
  if (r.sauteesVerrouillees > 0) {
    phrases.push(
      `${r.sauteesVerrouillees} saisie(s) appartenant à un CRA validé n'ont pas été modifiées.`,
    )
  }
  return phrases.join(' ')
}

/**
 * Reprend les réglages de l'instance Dolibarr — ceux que l'utilisateur a
 * cochés, et eux seuls.
 *
 * Rend toujours la main par une redirection porteuse d'un message et de sa
 * tonalité : une reprise refusée par la validation des réglages, ou une
 * instance injoignable, doivent se voir. Un `return` muet ferait passer les
 * deux pour un succès.
 */
export async function reprendreReglages(formData: FormData): Promise<void> {
  const user = await requireUser()

  const api = await getDolibarrApi()
  if (api === null) {
    redirect(annonce("Dolibarr n'est pas connecté : aucun réglage n'a été repris.", 'danger'))
    return
  }

  let message: string
  let tone: 'success' | 'danger' = 'success'
  try {
    message = resumeReprise(
      await applyDolibarrSetup({
        userId: user.id,
        api,
        // Une case non cochée n'est pas transmise du tout : l'absence vaut
        // « non », et une valeur forgée autre que « on » aussi.
        reprendreExercice: formData.get('reprendreExercice') === 'on',
        reprendreDureeJournee: formData.get('reprendreDureeJournee') === 'on',
        reetalonner: formData.get('reetalonner') === 'on',
      }),
    )
  } catch (err) {
    // Volontairement pas « aucun réglage n'a été repris » : une reprise peut
    // échouer sur le second réglage après avoir écrit le premier, et affirmer
    // le contraire enverrait vérifier au mauvais endroit.
    message = `La reprise n'a pas abouti : ${err instanceof Error ? err.message : String(err)}`
    tone = 'danger'
  }

  // La durée d'une journée est la conversion minutes → jours de toute
  // l'application : la grille de saisie, l'écran de réglages et le plan de
  // charge affichent tous des valeurs qui viennent de changer.
  revalidatePath(CHEMIN)
  revalidatePath('/admin/saisie')
  revalidatePath('/saisie')
  revalidatePath('/charge')
  redirect(annonce(message, tone))
}

/**
 * Un message porté par la redirection, avec sa tonalité : un refus affiché
 * comme un succès (bandeau vert, coche) contredirait le texte qu'il porte —
 * exactement le genre de confusion qu'une information non redondante avec la
 * seule couleur doit éviter.
 */
function annonce(message: string, tone: 'success' | 'danger' = 'success'): string {
  return `${CHEMIN}?message=${encodeURIComponent(message)}&tone=${tone}`
}
