import { prisma } from '@/db/client'
import { matchesSubscription, type AuditAction } from '@/core/audit/events'
import {
  buildEventPayload,
  serializeEventPayload,
  EN_TETE_EVENEMENT,
  EN_TETE_SEQ,
  EN_TETE_SIGNATURE,
  SEQ_ESSAI,
  type EventPayload,
} from '@/core/webhooks/payload'
import { signPayload } from '@/core/webhooks/signature'
import { readAuditSince } from '@/services/audit'
import { readSettingsRow } from '@/services/settings'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface DeliveryDeps {
  /** injectable pour les tests : aucun test n'appelle le réseau */
  fetchFn?: FetchLike
  now?: Date
}

/** Cinq tentatives : la première immédiate, quatre reprises avec recul. */
export const MAX_TENTATIVES = 5
export const RECULS_MINUTES: readonly number[] = [1, 5, 15, 60]

/** Combien d'événements en retard on rattrape par abonnement et par passage. */
const LOT_MAX = 200

export type DeliveryState = 'PENDING' | 'SUCCES' | 'ECHEC' | 'ABANDONNE'

export interface DeliveryView {
  id: string
  webhookId: string
  webhookLabel: string
  seq: number
  action: string
  state: DeliveryState
  attempts: number
  responseStatus: number
  durationMs: number
  lastError: string
  createdAt: Date
  deliveredAt: Date | null
}

export interface DistributionReport {
  abonnements: number
  creees: number
  tentees: number
  reussies: number
  echouees: number
  abandonnees: number
  suspendus: number
}

/** Message d'échec borné : la colonne n'est pas un journal d'exécution. */
function messageDe(err: unknown): string {
  const brut = err instanceof Error ? err.message : String(err)
  return brut.slice(0, 500)
}

async function corpsEtSignature(
  secret: string,
  seq: number,
): Promise<{ payload: EventPayload; corps: string; signature: string }> {
  const [entree] = await readAuditSince({ since: seq - 1, limit: 1 })
  if (entree === undefined || entree.seq !== seq) {
    throw new Error(`Journal : l'entrée ${seq} est introuvable.`)
  }

  // Le corps se reconstruit depuis le journal, immuable : c'est ce qui rend
  // un renvoi reproductible à l'octet près, signature comprise.
  const payload = buildEventPayload(entree)
  const corps = serializeEventPayload(payload)
  return { payload, corps, signature: signPayload(secret, corps) }
}

async function poster(
  fetchFn: FetchLike,
  url: string,
  corps: string,
  entetes: { event: string; seq: number; signature: string },
): Promise<{ ok: boolean; status: number; durationMs: number; erreur: string }> {
  const debut = Date.now()
  try {
    const reponse = await fetchFn(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [EN_TETE_EVENEMENT]: entetes.event,
        [EN_TETE_SEQ]: String(entetes.seq),
        [EN_TETE_SIGNATURE]: entetes.signature,
      },
      body: corps,
    })
    return {
      ok: reponse.ok,
      status: reponse.status,
      durationMs: Date.now() - debut,
      erreur: reponse.ok ? '' : `Réponse ${reponse.status}`,
    }
  } catch (err) {
    return { ok: false, status: 0, durationMs: Date.now() - debut, erreur: messageDe(err) }
  }
}

type LigneLivraison = Awaited<ReturnType<typeof prisma.webhookDelivery.findFirstOrThrow>>
type LigneAbonnement = Awaited<ReturnType<typeof prisma.webhook.findFirstOrThrow>>

/**
 * Une tentative, et toutes ses conséquences : l'état de la livraison, le
 * compteur d'échecs consécutifs de l'abonnement, et sa suspension éventuelle.
 */
async function tenter(
  livraison: LigneLivraison,
  abonnement: LigneAbonnement,
  now: Date,
  fetchFn: FetchLike,
  maxEchecs: number,
): Promise<{ reussie: boolean; abandonnee: boolean; suspendu: boolean }> {
  const { corps, signature } = await corpsEtSignature(abonnement.secret, livraison.seq)
  const resultat = await poster(fetchFn, abonnement.url, corps, {
    event: livraison.action,
    seq: livraison.seq,
    signature,
  })

  const tentatives = livraison.attempts + 1

  if (resultat.ok) {
    await prisma.webhookDelivery.update({
      where: { id: livraison.id },
      data: {
        state: 'SUCCES',
        attempts: tentatives,
        responseStatus: resultat.status,
        durationMs: resultat.durationMs,
        lastError: '',
        deliveredAt: now,
      },
    })
    // Un envoi réussi remet le compteur à zéro : c'est la succession
    // d'échecs qui dit une URL morte, pas leur cumul historique.
    await prisma.webhook.update({
      where: { id: abonnement.id },
      data: { consecutiveFailures: 0, lastError: '' },
    })
    return { reussie: true, abandonnee: false, suspendu: false }
  }

  const abandonnee = tentatives >= MAX_TENTATIVES
  const reculMinutes = RECULS_MINUTES[tentatives - 1] ?? RECULS_MINUTES[RECULS_MINUTES.length - 1]!

  await prisma.webhookDelivery.update({
    where: { id: livraison.id },
    data: {
      state: abandonnee ? 'ABANDONNE' : 'ECHEC',
      attempts: tentatives,
      responseStatus: resultat.status,
      durationMs: resultat.durationMs,
      lastError: resultat.erreur,
      nextAttemptAt: new Date(now.getTime() + reculMinutes * 60_000),
    },
  })

  const echecs = abonnement.consecutiveFailures + 1
  // Une URL morte rappelée toutes les cinq minutes pendant six mois est un
  // défaut, pas une résilience.
  const suspendu = echecs >= maxEchecs && abonnement.state === 'ACTIF'

  await prisma.webhook.update({
    where: { id: abonnement.id },
    data: {
      consecutiveFailures: echecs,
      lastError: resultat.erreur,
      ...(suspendu && { state: 'SUSPENDU', suspendedAt: now }),
    },
  })

  return { reussie: false, abandonnee, suspendu }
}

/**
 * Un passage complet : mise en file de ce qui manque, puis tentative de tout
 * ce qui est échu.
 *
 * La mise en file **relit le journal comme le ferait un consommateur** —
 * `readAuditSince` depuis le curseur de l'abonnement. Il n'existe donc qu'un
 * seul mécanisme de lecture pour le tirage et pour la poussée, et l'unicité
 * `(webhookId, seq)` suffit à l'idempotence.
 *
 * **Non scopée par utilisateur**, comme `flushAllProviders` : c'est un
 * traitement de fond réveillé par un jeton d'instance, qui n'a pas de session
 * et doit servir tous les abonnements. Les lectures d'écran (`listDeliveries`)
 * restent scopées, elles.
 */
export async function distributeWebhooks(deps: DeliveryDeps = {}): Promise<DistributionReport> {
  const now = deps.now ?? new Date()
  const fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init))
  // `readSettingsRow` et non un `findUniqueOrThrow` : sur une installation
  // neuve, la ligne de réglages n'existe pas encore, et un traitement de
  // fond qui échouerait pour cette raison échouerait à chaque réveil — un
  // échec perpétuel noie les vraies alertes. C'est aussi le seul point de
  // création de cette ligne dans le projet.
  const { webhookMaxEchecs } = await readSettingsRow()

  const abonnements = await prisma.webhook.findMany({ where: { state: 'ACTIF' } })

  const rapport: DistributionReport = {
    abonnements: abonnements.length,
    creees: 0,
    tentees: 0,
    reussies: 0,
    echouees: 0,
    abandonnees: 0,
    suspendus: 0,
  }

  for (const abonnement of abonnements) {
    const entrees = await readAuditSince({ since: abonnement.lastSeq, limit: LOT_MAX })
    if (entrees.length === 0) continue

    for (const entree of entrees) {
      if (!matchesSubscription(abonnement.events, entree.action as AuditAction)) continue

      // `createMany` + `skipDuplicates` n'est pas portable sur SQLite :
      // une création unitaire tolérante au conflit l'est.
      try {
        await prisma.webhookDelivery.create({
          data: {
            webhookId: abonnement.id,
            seq: entree.seq,
            action: entree.action,
            nextAttemptAt: now,
          },
        })
        rapport.creees++
      } catch {
        // Déjà en file pour cet abonnement : c'est exactement ce que
        // l'unicité (webhookId, seq) doit produire.
      }
    }

    await prisma.webhook.update({
      where: { id: abonnement.id },
      data: { lastSeq: entrees[entrees.length - 1]!.seq },
    })
  }

  // Deuxième temps : on tente. Relire l'abonnement à chaque livraison est
  // délibéré — sans cela, une suspension décidée à la livraison n° 3 ne
  // serait pas vue par la livraison n° 4 du même passage.
  const echues = await prisma.webhookDelivery.findMany({
    where: { state: { in: ['PENDING', 'ECHEC'] }, nextAttemptAt: { lte: now } },
    orderBy: { seq: 'asc' },
  })

  for (const livraison of echues) {
    const abonnement = await prisma.webhook.findUnique({ where: { id: livraison.webhookId } })
    if (abonnement === null || abonnement.state !== 'ACTIF') continue

    rapport.tentees++
    // L'échec d'un abonnement ne doit jamais interrompre le passage.
    try {
      const issue = await tenter(livraison, abonnement, now, fetchFn, webhookMaxEchecs)
      if (issue.reussie) rapport.reussies++
      else rapport.echouees++
      if (issue.abandonnee) rapport.abandonnees++
      if (issue.suspendu) rapport.suspendus++
    } catch (err) {
      rapport.echouees++
      await prisma.webhookDelivery.update({
        where: { id: livraison.id },
        data: { state: 'ECHEC', lastError: messageDe(err) },
      })
    }
  }

  return rapport
}

type LigneAvecAbonnement = LigneLivraison & { webhook: { label: string } }

function toDeliveryView(row: LigneAvecAbonnement): DeliveryView {
  return {
    id: row.id,
    webhookId: row.webhookId,
    webhookLabel: row.webhook.label,
    seq: row.seq,
    action: row.action,
    state: row.state as DeliveryState,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    durationMs: row.durationMs,
    lastError: row.lastError,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
  }
}

export async function listDeliveries(userId: string, limit = 100): Promise<DeliveryView[]> {
  const rows = await prisma.webhookDelivery.findMany({
    where: { webhook: { userId } },
    include: { webhook: { select: { label: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
  return rows.map(toDeliveryView)
}

/**
 * Renvoi à la main depuis la supervision. Le corps et la signature sont
 * **identiques** à ceux de la première tentative : ils se reconstruisent
 * depuis une entrée de journal qui n'a pas pu changer.
 */
export async function resendDelivery(
  userId: string,
  deliveryId: string,
  deps: DeliveryDeps = {},
): Promise<DeliveryView> {
  const now = deps.now ?? new Date()
  const fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init))
  // `readSettingsRow` et non un `findUniqueOrThrow` : sur une installation
  // neuve, la ligne de réglages n'existe pas encore, et un traitement de
  // fond qui échouerait pour cette raison échouerait à chaque réveil — un
  // échec perpétuel noie les vraies alertes. C'est aussi le seul point de
  // création de cette ligne dans le projet.
  const { webhookMaxEchecs } = await readSettingsRow()

  const livraison = await prisma.webhookDelivery.findFirstOrThrow({
    where: { id: deliveryId, webhook: { userId } },
  })
  const abonnement = await prisma.webhook.findUniqueOrThrow({ where: { id: livraison.webhookId } })

  // Un renvoi rouvre le compteur de tentatives : c'est un geste humain,
  // délibéré, sur une livraison qu'on a décidé de ne pas laisser tomber.
  const rouverte = await prisma.webhookDelivery.update({
    where: { id: livraison.id },
    data: { state: 'PENDING', attempts: 0, nextAttemptAt: now },
  })

  await tenter(rouverte, abonnement, now, fetchFn, webhookMaxEchecs)

  const relu = await prisma.webhookDelivery.findFirstOrThrow({
    where: { id: livraison.id },
    include: { webhook: { select: { label: true } } },
  })
  return toDeliveryView(relu)
}

/**
 * Le bouton d'essai : vérifier qu'une URL répond **avant** d'en dépendre.
 *
 * Il n'écrit rien — ni au journal, ni en file — et ne touche ni au compteur
 * d'échecs ni à l'état de l'abonnement. Il fonctionne sur un abonnement
 * suspendu : c'est précisément le moment où l'on veut savoir si l'URL est
 * revenue.
 *
 * `seq: 0` marque l'essai : le journal numérote à partir de 1, un
 * consommateur distingue donc l'essai sans vocabulaire supplémentaire.
 */
export async function sendTestWebhook(
  userId: string,
  webhookId: string,
  deps: DeliveryDeps = {},
): Promise<{ ok: boolean; status: number; durationMs: number; erreur: string }> {
  const now = deps.now ?? new Date()
  const fetchFn = deps.fetchFn ?? ((url, init) => fetch(url, init))

  const abonnement = await prisma.webhook.findFirstOrThrow({ where: { id: webhookId, userId } })

  const payload = buildEventPayload({
    seq: SEQ_ESSAI,
    occurredAt: now,
    action: 'cra.valide',
    actorId: '',
    actorLabel: 'SYSTEME',
    entityType: 'Essai',
    entityId: 'essai',
    payload: { essai: true, abonnement: abonnement.label },
  })
  const corps = serializeEventPayload(payload)

  return poster(fetchFn, abonnement.url, corps, {
    event: payload.event,
    seq: SEQ_ESSAI,
    signature: signPayload(abonnement.secret, corps),
  })
}
