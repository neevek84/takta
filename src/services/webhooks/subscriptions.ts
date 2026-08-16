import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { parseSubscription, serializeSubscription, type AuditAction } from '@/core/audit/events'
import { currentAuditSeq } from '@/services/audit'
import { readSettingsRow } from '@/services/settings'

export type WebhookState = 'ACTIF' | 'SUSPENDU'

export interface WebhookView {
  id: string
  label: string
  url: string
  /** vide = tous les événements */
  events: AuditAction[]
  state: WebhookState
  /** dernier seq du journal déjà pris en compte */
  lastSeq: number
  consecutiveFailures: number
  lastError: string
  suspendedAt: Date | null
}

export class WebhookValidationError extends Error {
  errors: string[]

  constructor(errors: string[]) {
    super(errors.join(' '))
    this.name = 'WebhookValidationError'
    this.errors = errors
  }
}

type Row = Awaited<ReturnType<typeof prisma.webhook.findFirstOrThrow>>

/** `secret` est absent de la vue : il sert à signer, pas à être affiché. */
function toView(row: Row): WebhookView {
  return {
    id: row.id,
    label: row.label,
    url: row.url,
    events: parseSubscription(row.events),
    state: row.state as WebhookState,
    lastSeq: row.lastSeq,
    consecutiveFailures: row.consecutiveFailures,
    lastError: row.lastError,
    suspendedAt: row.suspendedAt,
  }
}

function valider(champs: { label?: string; url?: string; secret?: string }): void {
  const errors: string[] = []

  if (champs.label !== undefined && champs.label.trim() === '') {
    errors.push("Le libellé de l'abonnement est requis.")
  }

  if (champs.url !== undefined) {
    let protocole = ''
    try {
      protocole = new URL(champs.url).protocol
    } catch {
      protocole = ''
    }
    if (protocole !== 'http:' && protocole !== 'https:') {
      errors.push("L'URL doit être une adresse http ou https absolue.")
    }
  }

  /**
   * **Un abonnement sans secret est refusé.** Signer avec une chaîne vide
   * revient à ne pas signer : quiconque connaît l'URL pourrait alors
   * fabriquer un événement que le destinataire croirait authentique, et
   * déclencher chez lui les écritures que ce flux commande. Ne pas fournir de
   * secret est en revanche parfaitement légitime — un secret aléatoire est
   * alors engendré ci-dessous.
   */
  if (champs.secret !== undefined && champs.secret.trim() === '') {
    errors.push(
      "Le secret de signature ne peut pas être vide : laissez le champ vide pour qu'un secret soit engendré.",
    )
  }

  if (errors.length > 0) throw new WebhookValidationError(errors)
}

export async function createWebhook(
  userId: string,
  args: { label: string; url: string; events: AuditAction[]; secret?: string },
): Promise<WebhookView> {
  valider({ label: args.label, url: args.url, ...(args.secret !== undefined && { secret: args.secret }) })

  // Un abonnement neuf part de maintenant : il n'a pas à rejouer l'histoire
  // antérieure à son existence.
  const lastSeq = await currentAuditSeq()

  const row = await prisma.webhook.create({
    data: {
      userId,
      label: args.label.trim(),
      url: args.url,
      secret: args.secret ?? randomBytes(32).toString('hex'),
      events: serializeSubscription(args.events),
      lastSeq,
    },
  })
  return toView(row)
}

/**
 * Le nombre d'échecs consécutifs au bout duquel un abonnement est suspendu.
 *
 * Exposé pour l'écran, et pas seulement pour la livraison : ce compteur est
 * **commun à tous les événements** de l'abonnement, si bien que deux
 * événements malheureux se cumulent et rapprochent de la suspension un
 * abonnement dont l'URL répond par ailleurs. Afficher le compte et son seuil
 * est le seul moyen de ne pas découvrir la suspension après coup.
 */
export async function readSeuilSuspension(): Promise<number> {
  return (await readSettingsRow()).webhookMaxEchecs
}

export async function listWebhooks(userId: string): Promise<WebhookView[]> {
  const rows = await prisma.webhook.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })
  return rows.map(toView)
}

export async function getWebhook(userId: string, id: string): Promise<WebhookView> {
  // Le scope par userId dans le `where` est la garantie : jamais un
  // findUnique suivi d'une comparaison, qui laisserait fuiter l'existence.
  return toView(await prisma.webhook.findFirstOrThrow({ where: { id, userId } }))
}

export async function updateWebhook(
  userId: string,
  id: string,
  patch: { label?: string; url?: string; events?: AuditAction[]; state?: WebhookState },
): Promise<WebhookView> {
  valider(patch)

  const actuel = await prisma.webhook.findFirstOrThrow({ where: { id, userId } })

  /**
   * Réactiver ne déverse pas l'arriéré : `lastSeq` repart du sommet du
   * journal. Rien n'est perdu pour autant — les événements de la période
   * suspendue restent lisibles par `GET /api/events?since=<lastSeq>`, et
   * c'est exactement pour cela que le tirage est la garantie et la poussée
   * un simple confort.
   */
  const reprise = patch.state === 'ACTIF' && actuel.state === 'SUSPENDU'
  const suspension = patch.state === 'SUSPENDU' && actuel.state === 'ACTIF'
  const sommet = reprise ? await currentAuditSeq() : 0

  const row = await prisma.webhook.update({
    where: { id: actuel.id },
    data: {
      ...(patch.label !== undefined && { label: patch.label.trim() }),
      ...(patch.url !== undefined && { url: patch.url }),
      ...(patch.events !== undefined && { events: serializeSubscription(patch.events) }),
      ...(patch.state !== undefined && { state: patch.state }),
      ...(reprise && {
        lastSeq: sommet,
        consecutiveFailures: 0,
        lastError: '',
        suspendedAt: null,
      }),
      ...(suspension && { suspendedAt: new Date() }),
    },
  })
  return toView(row)
}

export async function deleteWebhook(userId: string, id: string): Promise<void> {
  const cible = await prisma.webhook.findFirstOrThrow({ where: { id, userId } })
  await prisma.webhook.delete({ where: { id: cible.id } })
}

/**
 * Le secret, pour le seul module qui en a besoin : la signature des appels
 * sortants. Volontairement séparé de `getWebhook`, pour qu'un secret ne
 * puisse pas se retrouver dans une vue par inadvertance.
 */
export async function getWebhookSecret(userId: string, id: string): Promise<string> {
  const row = await prisma.webhook.findFirstOrThrow({
    where: { id, userId },
    select: { secret: true },
  })
  return row.secret
}
