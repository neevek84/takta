'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { runJobNow, setJobEnabled } from '@/services/jobs/scheduler'
import { resendDelivery } from '@/services/webhooks/delivery'

const CHEMIN = '/admin/supervision'
const CHEMIN_ABONNEMENTS = '/admin/webhooks'

type Tone = 'success' | 'warning' | 'danger'

/**
 * Un message porté par la redirection, **avec sa tonalité**. Un écran voisin
 * affichait tout retour de la même façon — bandeau vert et coche, refus
 * compris. La tonalité voyage donc avec le message, de bout en bout ; l'écran
 * qui la reçoit retombe sur l'avertissement quand elle manque, jamais sur le
 * succès.
 */
function annonce(chemin: string, message: string, tone: Tone = 'success'): string {
  return `${chemin}?message=${encodeURIComponent(message)}&tone=${tone}`
}

function messageDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Les deux seules destinations admises. Le champ vient du formulaire : le
 * suivre tel quel ferait de ce bouton une redirection ouverte.
 */
function retourAdmis(brut: unknown): string {
  return brut === CHEMIN_ABONNEMENTS ? CHEMIN_ABONNEMENTS : CHEMIN
}

/** L'état d'un travail décide de la tonalité : `INDISPONIBLE` n'est pas un succès. */
function tonaliteDuTravail(state: string): Tone {
  if (state === 'SUCCES') return 'success'
  if (state === 'ECHEC') return 'danger'
  return 'warning'
}

export async function executerTravail(formData: FormData): Promise<void> {
  const user = await requireUser()
  const name = String(formData.get('name') ?? '')

  let message: string
  let tone: Tone
  try {
    const rapport = await runJobNow(user.id, name)
    message = `${name} : ${rapport.message}`
    tone = tonaliteDuTravail(rapport.state)
  } catch (err) {
    message = `Le travail « ${name} » n'a pas pu être exécuté : ${messageDe(err)}`
    tone = 'danger'
  }

  revalidatePath(CHEMIN)
  redirect(annonce(CHEMIN, message, tone))
}

export async function basculerTravail(formData: FormData): Promise<void> {
  const user = await requireUser()
  const name = String(formData.get('name') ?? '')
  // Une valeur autre que « 1 » vaut « non » : l'absence comme la valeur forgée.
  const enabled = formData.get('enabled') === '1'

  let message: string
  let tone: Tone
  try {
    await setJobEnabled(user.id, name, enabled)
    message = enabled ? `Le travail « ${name} » est activé.` : `Le travail « ${name} » est désactivé.`
    tone = 'success'
  } catch (err) {
    message = `Le travail « ${name} » n'a pas pu être modifié : ${messageDe(err)}`
    tone = 'danger'
  }

  revalidatePath(CHEMIN)
  redirect(annonce(CHEMIN, message, tone))
}

/** Partagée par les deux écrans : un renvoi est un renvoi, deux copies divergeraient. */
export async function renvoyerLivraison(formData: FormData): Promise<void> {
  const user = await requireUser()
  const id = String(formData.get('id') ?? '')
  const retour = retourAdmis(formData.get('retour'))

  let message: string
  let tone: Tone
  try {
    const livraison = await resendDelivery(user.id, id)
    // Un renvoi qui échoue encore n'est pas une réussite : c'est l'état rendu
    // par le service qui décide, jamais le simple fait d'avoir cliqué.
    if (livraison.state === 'SUCCES') {
      message = `Livraison renvoyée : réponse ${livraison.responseStatus}.`
      tone = 'success'
    } else {
      message = `Le renvoi n'a pas abouti : réponse ${livraison.responseStatus}.`
      tone = 'danger'
    }
  } catch (err) {
    message = `Le renvoi n'a pas abouti : ${messageDe(err)}`
    tone = 'danger'
  }

  revalidatePath(CHEMIN)
  revalidatePath(CHEMIN_ABONNEMENTS)
  redirect(annonce(retour, message, tone))
}
