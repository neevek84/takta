import { prisma } from '@/db/client'
import { verifyWebhookSignature } from '@/core/signature/webhook'
import type { SignatureConnector } from '@/core/signature/connector'
import { applySignatureStatus, type SignatureEffet } from './apply'
import { ENTITY_CRA, PROVIDER_DOCUMENSO } from './constants'
import { parseDocumensoWebhook } from './documenso'
import { getSignatureConnector } from './registry'

export type WebhookOutcome =
  | { ok: true; effet: SignatureEffet | 'REJOUE'; craId: string | null }
  | { ok: false; raison: 'SIGNATURE_INVALIDE' | 'CHARGE_ILLISIBLE' | 'LIEN_INCONNU' }

/**
 * Réception d'un webhook de signature.
 *
 * Trois barrières, dans cet ordre :
 *
 * 1. **La signature de la charge utile.** Sans secret configuré ou sans
 *    signature valide, rien ne se passe : ce webhook fait franchir une
 *    transition qui verrouille un mois et peut déclencher une facturation en
 *    aval. Jamais un jeton dans l'URL — il fuit dans les journaux d'accès et
 *    ne prouve rien sur le contenu reçu.
 * 2. **La lecture de la charge**, propre au prestataire.
 * 3. **L'unicité de l'événement.** Consignée *avant* d'agir : c'est ce qui
 *    garantit qu'un rejeu n'a aucun effet, même si l'application redémarre
 *    entre deux livraisons. La contrepartie assumée est qu'un événement dont
 *    le traitement échoue ne sera pas rejoué automatiquement — le
 *    rafraîchissement à la demande est là pour ça.
 *
 * Rien n'est journalisé ici : ni la charge, ni la signature, ni le secret.
 * Le résultat rendu à la route ne porte aucun identifiant interne dans les
 * cas de refus.
 */
export async function handleSignatureWebhook(args: {
  rawBody: string
  signatureHeader: string
  secret?: string
  connector?: SignatureConnector | null
}): Promise<WebhookOutcome> {
  const secret = args.secret ?? process.env.SIGNATURE_WEBHOOK_SECRET ?? ''

  if (!verifyWebhookSignature(args.rawBody, args.signatureHeader, secret)) {
    return { ok: false, raison: 'SIGNATURE_INVALIDE' }
  }

  const lu = parseDocumensoWebhook(args.rawBody)
  if (lu === null) return { ok: false, raison: 'CHARGE_ILLISIBLE' }

  try {
    await prisma.signatureWebhookEvent.create({
      data: { provider: PROVIDER_DOCUMENSO, eventId: lu.eventId },
    })
  } catch {
    // L'unicité (provider, eventId) a parlé : cet événement a déjà été traité.
    return { ok: true, effet: 'REJOUE', craId: null }
  }

  const lien = await prisma.externalLink.findFirst({
    where: {
      entityType: ENTITY_CRA,
      provider: PROVIDER_DOCUMENSO,
      externalId: lu.externalId,
    },
    select: { entityId: true },
  })
  if (lien === null) return { ok: false, raison: 'LIEN_INCONNU' }

  const connector =
    args.connector !== undefined ? args.connector : await getSignatureConnector()

  const effet = await applySignatureStatus({
    craId: lien.entityId,
    externalId: lu.externalId,
    statut: lu.statut,
    connector,
  })

  await prisma.externalLink.updateMany({
    where: { entityType: ENTITY_CRA, entityId: lien.entityId, provider: PROVIDER_DOCUMENSO },
    data: { syncState: lu.statut, syncedAt: new Date() },
  })

  return { ok: true, effet, craId: lien.entityId }
}
