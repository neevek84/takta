/** Les trois en-têtes qui accompagnent chaque appel sortant. */
export const EN_TETE_EVENEMENT = 'X-CRA-Event'
export const EN_TETE_SEQ = 'X-CRA-Seq'
export const EN_TETE_SIGNATURE = 'X-CRA-Signature'

/**
 * Numéro d'ordre d'un événement d'essai. Le journal numérote à partir de 1 :
 * zéro ne peut désigner qu'un essai, et le consommateur le distingue sans
 * qu'on ait eu à inventer un vocabulaire pour le dire.
 */
export const SEQ_ESSAI = 0

export interface EventPayload {
  event: string
  seq: number
  /** ISO 8601 UTC */
  occurredAt: string
  actor: { id: string; label: string }
  entity: { type: string; id: string }
  data: Record<string, unknown>
}

export function buildEventPayload(entree: {
  seq: number
  occurredAt: Date
  action: string
  actorId: string
  actorLabel: string
  entityType: string
  entityId: string
  payload: Record<string, unknown>
}): EventPayload {
  return {
    event: entree.action,
    seq: entree.seq,
    occurredAt: entree.occurredAt.toISOString(),
    actor: { id: entree.actorId, label: entree.actorLabel },
    entity: { type: entree.entityType, id: entree.entityId },
    data: entree.payload,
  }
}

/**
 * Le corps **brut** : c'est lui qui part sur le réseau et lui qui est signé.
 * Signer un objet resérialisé ailleurs produirait une signature que le
 * destinataire ne pourrait pas reproduire.
 *
 * L'ordre des clés du littéral de `buildEventPayload` suffit à placer `event`
 * et `seq` en tête : `JSON.stringify` respecte l'ordre d'insertion pour les
 * clés non numériques, et ce littéral est écrit à la main, pas construit
 * dynamiquement.
 */
export function serializeEventPayload(p: EventPayload): string {
  return JSON.stringify(p)
}
