'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser, exigerAdministration } from '@/auth'
import { isAuditAction, type AuditAction } from '@/core/audit/events'
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  updateWebhook,
  type WebhookState,
} from '@/services/webhooks/subscriptions'
import { sendTestWebhook } from '@/services/webhooks/delivery'

const CHEMIN = '/admin/webhooks'

type Tone = 'success' | 'danger'

/**
 * Le message **et sa tonalité**. Un abonnement refusé, une URL muette, un
 * renvoi qui échoue : tout cela s'affiche comme ce que c'est, et jamais avec
 * l'apparence d'une réussite.
 */
function annonce(message: string, tone: Tone = 'success'): string {
  return `${CHEMIN}?message=${encodeURIComponent(message)}&tone=${tone}`
}

function messageDe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Les noms hors catalogue sont écartés : ils ne s'abonneraient à rien. */
function evenementsDe(formData: FormData): AuditAction[] {
  return formData.getAll('events').map(String).filter(isAuditAction)
}

/** L'état vient du formulaire : seules les deux valeurs du domaine sont admises. */
function etatDe(brut: unknown): WebhookState | null {
  return brut === 'ACTIF' || brut === 'SUSPENDU' ? brut : null
}

export async function creerAbonnement(formData: FormData): Promise<void> {
  const user = await exigerAdministration()

  let message: string
  let tone: Tone
  try {
    const abonnement = await createWebhook(user.id, {
      label: String(formData.get('label') ?? ''),
      url: String(formData.get('url') ?? ''),
      events: evenementsDe(formData),
    })
    message = `Abonnement « ${abonnement.label} » créé. Il ne recevra que les événements postérieurs au n° ${abonnement.lastSeq}.`
    tone = 'success'
  } catch (err) {
    message = `L'abonnement n'a pas été créé : ${messageDe(err)}`
    tone = 'danger'
  }

  revalidatePath(CHEMIN)
  redirect(annonce(message, tone))
}

export async function modifierAbonnement(formData: FormData): Promise<void> {
  const user = await exigerAdministration()
  const id = String(formData.get('id') ?? '')
  const etat = formData.has('state') ? etatDe(formData.get('state')) : undefined

  if (etat === null) {
    redirect(annonce("L'état demandé n'existe pas : l'abonnement n'a pas été modifié.", 'danger'))
    return
  }

  let message: string
  let tone: Tone
  try {
    // L'état **avant** : la réactivation fait sauter `lastSeq` au sommet du
    // journal, et le curseur d'où reprendre ne se retrouve plus après coup.
    const avant = await getWebhook(user.id, id)
    const apres = await updateWebhook(user.id, id, {
      ...(etat !== undefined && { state: etat }),
      ...(formData.has('events') && { events: evenementsDe(formData) }),
    })

    if (etat === 'ACTIF' && avant.state === 'SUSPENDU') {
      message =
        `Abonnement « ${apres.label} » réactivé : la poussée reprend au n° ${apres.lastSeq}. ` +
        `Les événements ${avant.lastSeq + 1} à ${apres.lastSeq} ne seront pas poussés — ` +
        `ils restent lisibles par GET /api/events?since=${avant.lastSeq}.`
    } else if (etat === 'SUSPENDU') {
      message = `Abonnement « ${apres.label} » suspendu. Rien ne lui sera plus poussé.`
    } else {
      message = `Abonnement « ${apres.label} » modifié.`
    }
    tone = 'success'
  } catch (err) {
    message = `L'abonnement n'a pas été modifié : ${messageDe(err)}`
    tone = 'danger'
  }

  revalidatePath(CHEMIN)
  redirect(annonce(message, tone))
}

export async function supprimerAbonnement(formData: FormData): Promise<void> {
  const user = await exigerAdministration()
  const id = String(formData.get('id') ?? '')

  let message: string
  let tone: Tone
  try {
    await deleteWebhook(user.id, id)
    message = "L'abonnement a été supprimé. Le journal, lui, garde tout."
    tone = 'success'
  } catch (err) {
    message = `L'abonnement n'a pas été supprimé : ${messageDe(err)}`
    tone = 'danger'
  }

  revalidatePath(CHEMIN)
  redirect(annonce(message, tone))
}

/**
 * L'essai n'écrit rien — ni au journal, ni en file. Son seul produit est ce
 * message : il doit donc dire la vérité, y compris quand elle déplaît.
 */
export async function essayerAbonnement(formData: FormData): Promise<void> {
  const user = await exigerAdministration()
  const id = String(formData.get('id') ?? '')

  let message: string
  let tone: Tone
  try {
    const essai = await sendTestWebhook(user.id, id)
    if (essai.ok) {
      message = `L'URL a répondu ${essai.status} en ${essai.durationMs} ms.`
      tone = 'success'
    } else {
      message = `L'URL n'a pas répondu correctement : ${essai.erreur === '' ? `réponse ${essai.status}` : essai.erreur}.`
      tone = 'danger'
    }
  } catch (err) {
    message = `L'essai n'a pas pu être mené : ${messageDe(err)}`
    tone = 'danger'
  }

  revalidatePath(CHEMIN)
  redirect(annonce(message, tone))
}
