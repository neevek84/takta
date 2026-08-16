import { describe, it, expect } from 'vitest'
import {
  buildEventPayload,
  serializeEventPayload,
  SEQ_ESSAI,
  EN_TETE_EVENEMENT,
  EN_TETE_SEQ,
  EN_TETE_SIGNATURE,
} from './payload'

const ENTREE = {
  seq: 1234,
  occurredAt: new Date('2026-08-15T09:12:03.000Z'),
  action: 'cra.valide',
  actorId: 'usr_1',
  actorLabel: 'Keveen',
  entityType: 'Cra',
  entityId: 'cra_1',
  payload: { missionId: 'm1', month: '2026-07' },
}

describe('charge utile', () => {
  it('a exactement la forme annoncée par la spec', () => {
    expect(buildEventPayload(ENTREE)).toEqual({
      event: 'cra.valide',
      seq: 1234,
      occurredAt: '2026-08-15T09:12:03.000Z',
      actor: { id: 'usr_1', label: 'Keveen' },
      entity: { type: 'Cra', id: 'cra_1' },
      data: { missionId: 'm1', month: '2026-07' },
    })
  })

  it('sérialise l horodatage en ISO 8601 UTC', () => {
    expect(buildEventPayload(ENTREE).occurredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    )
  })

  it('produit un corps brut stable', () => {
    const p = buildEventPayload(ENTREE)
    expect(serializeEventPayload(p)).toBe(serializeEventPayload(buildEventPayload(ENTREE)))
    expect(JSON.parse(serializeEventPayload(p))).toEqual(p)
  })

  it('place event et seq en tête du corps, pour la lisibilité humaine', () => {
    expect(serializeEventPayload(buildEventPayload(ENTREE))).toMatch(
      /^\{"event":"cra\.valide","seq":1234,/,
    )
  })

  it('réserve le numéro zéro à l essai', () => {
    // seq commence à 1 dans le journal : zéro ne peut désigner qu un essai,
    // sans qu il faille inventer un vocabulaire pour le dire.
    expect(SEQ_ESSAI).toBe(0)
  })

  it('nomme ses en-têtes une seule fois', () => {
    expect([EN_TETE_EVENEMENT, EN_TETE_SEQ, EN_TETE_SIGNATURE]).toEqual([
      'X-CRA-Event',
      'X-CRA-Seq',
      'X-CRA-Signature',
    ])
  })
})
