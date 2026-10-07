import { prisma } from '@/db/client'
import { verifierSecretDocumenso, verifyWebhookSignature } from '@/core/signature/webhook'
import type { SignatureConnector, SignatureEtat } from '@/core/signature/connector'
import type { Mailer } from '@/services/notify'
import { applySignatureStatus, type SignatureEffet } from './apply'
import { ENTITY_CRA, PROVIDER_DOCUMENSO } from './constants'
import { parseDocumensoWebhook } from './documenso'
import { getSignatureConnector } from './registry'

export type WebhookOutcome =
  | { ok: true; effet: SignatureEffet | 'REJOUE'; craId: string | null }
  | {
      ok: false
      raison: 'SIGNATURE_INVALIDE' | 'CHARGE_ILLISIBLE' | 'LIEN_INCONNU' | 'PRESTATAIRE_INJOIGNABLE'
    }

/**
 * Réception d'un webhook de signature — **un signal, plus une source de
 * vérité**.
 *
 * 1. **L'origine** : `X-Documenso-Secret` (ce que Documenso envoie
 *    réellement), ou un HMAC `x-cra-signature` (intégrations maison, tests).
 * 2. **La lecture** : quelle enveloppe, quel événement.
 * 3. **La résolution** du lien externe, sans effet. Elle précède la
 *    consignation : une livraison arrivée avant que `sendCraForSignature`
 *    n'ait écrit son `ExternalLink` ne doit rien brûler, sans quoi la
 *    relivraison serait rejetée comme un rejeu.
 * 4. **La relecture chez le prestataire.** Un secret prouve l'origine, pas
 *    l'intégrité : c'est l'état que rend `status()` qui s'applique, jamais
 *    celui que la charge raconte. Un prestataire injoignable ne consomme
 *    rien — la relivraison, ou le balayage, agiront.
 * 5. **L'unicité de l'événement**, consignée avant d'agir. La contrepartie
 *    assumée : un événement dont le traitement échoue ensuite n'est pas rejoué
 *    automatiquement — le rafraîchissement à la demande est là pour ça.
 *
 * Appelé sans session. Rien n'est journalisé ici : ni la charge, ni le secret.
 */
export async function handleSignatureWebhook(args: {
  rawBody: string
  secretHeader: string
  signatureHeader: string
  secret?: string
  connector?: SignatureConnector | null
  mailer?: Mailer | null
}): Promise<WebhookOutcome> {
  const secret = args.secret ?? process.env.SIGNATURE_WEBHOOK_SECRET ?? ''

  const authentique =
    verifierSecretDocumenso(args.secretHeader, secret) ||
    verifyWebhookSignature(args.rawBody, args.signatureHeader, secret)
  if (!authentique) return { ok: false, raison: 'SIGNATURE_INVALIDE' }

  const lu = parseDocumensoWebhook(args.rawBody)
  if (lu === null) return { ok: false, raison: 'CHARGE_ILLISIBLE' }

  const lien = await prisma.externalLink.findFirst({
    where: { entityType: ENTITY_CRA, provider: PROVIDER_DOCUMENSO, externalId: { in: lu.candidats } },
    select: { entityId: true, externalId: true },
  })
  if (lien === null) return { ok: false, raison: 'LIEN_INCONNU' }

  const connector =
    args.connector !== undefined ? args.connector : await getSignatureConnector()
  if (connector === null) return { ok: false, raison: 'PRESTATAIRE_INJOIGNABLE' }

  let etat: SignatureEtat
  try {
    etat = await connector.status(lien.externalId)
  } catch {
    return { ok: false, raison: 'PRESTATAIRE_INJOIGNABLE' }
  }

  try {
    await prisma.signatureWebhookEvent.create({
      data: { provider: PROVIDER_DOCUMENSO, eventId: lu.eventId },
    })
  } catch {
    // L'unicité (provider, eventId) a parlé : cet événement a déjà été traité.
    return { ok: true, effet: 'REJOUE', craId: null }
  }

  const effet = await applySignatureStatus({
    craId: lien.entityId,
    externalId: lien.externalId,
    statut: etat.statut,
    motifRefus: etat.motifRefus,
    connector,
    mailer: args.mailer ?? null,
  })

  await prisma.externalLink.updateMany({
    where: { entityType: ENTITY_CRA, entityId: lien.entityId, provider: PROVIDER_DOCUMENSO },
    data: { syncState: etat.statut, syncedAt: new Date() },
  })

  return { ok: true, effet, craId: lien.entityId }
}
