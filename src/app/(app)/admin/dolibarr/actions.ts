'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { saveInstanceCredential, revokeInstanceCredential } from '@/services/credentials'
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

/** Une URL absolue en http(s) : le reste ne peut produire qu'un faux diagnostic. */
function urlAbsolue(valeur: string): boolean {
  try {
    const u = new URL(valeur)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
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

  const baseUrl = String(formData.get('baseUrl') ?? '').trim()
  const apiKey = String(formData.get('apiKey') ?? '').trim()
  const dolibarrUserId = String(formData.get('dolibarrUserId') ?? '').trim()

  const erreurs: string[] = []
  if (baseUrl === '') erreurs.push("L'URL de l'API Dolibarr est requise.")
  else if (!urlAbsolue(baseUrl)) {
    erreurs.push("L'URL doit être complète, protocole compris (https://…).")
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

  revalidatePath(CHEMIN)
  return { ok: true, message: 'Connexion à Dolibarr enregistrée.' }
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
export async function rattacherProjet(formData: FormData): Promise<void> {
  const user = await requireUser()
  const dolibarrProjectId = Number(formData.get('dolibarrId'))
  const projectRef = String(formData.get('ref') ?? '')
  const socidBrut = String(formData.get('socid') ?? '')
  const projectSocid = socidBrut === '' ? null : Number(socidBrut)
  const missionId = String(formData.get('missionId') ?? '')

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
      await attachMission({ userId: user.id, missionId, dolibarrProjectId, projectRef, projectSocid })
    }
  } catch (err) {
    redirect(annonce(err instanceof Error ? err.message : String(err), 'danger'))
    return
  }
  revalidatePath(CHEMIN)
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
 * Un message porté par la redirection, avec sa tonalité : un refus affiché
 * comme un succès (bandeau vert, coche) contredirait le texte qu'il porte —
 * exactement le genre de confusion qu'une information non redondante avec la
 * seule couleur doit éviter.
 */
function annonce(message: string, tone: 'success' | 'danger' = 'success'): string {
  return `${CHEMIN}?message=${encodeURIComponent(message)}&tone=${tone}`
}
