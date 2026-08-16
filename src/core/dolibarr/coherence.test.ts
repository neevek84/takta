import { describe, it, expect } from 'vitest'
import { verifierCoherenceTiers } from './coherence'

describe('verifierCoherenceTiers', () => {
  it('laisse passer quand le projet et le client pointent vers le même tiers', () => {
    expect(() =>
      verifierCoherenceTiers({
        projectRef: 'PJ001',
        projectSocid: 5,
        clientLabel: 'ACME',
        expectedThirdpartyId: 5,
      }),
    ).not.toThrow()
  })

  it('refuse de rattacher le projet du tiers A à une mission du client B', () => {
    // Le scénario du mauvais client : les temps partiraient chez « ACME »
    // alors que le projet appartient au tiers 5, pas au tiers 7 auquel ACME
    // est rattaché.
    expect(() =>
      verifierCoherenceTiers({
        projectRef: 'PJ001',
        projectSocid: 5,
        clientLabel: 'ACME',
        expectedThirdpartyId: 7,
      }),
    ).toThrow(/PJ001.*tiers Dolibarr n° 5.*ACME.*tiers Dolibarr n° 7/s)
  })

  it('laisse passer un projet sans tiers, que Dolibarr autorise', () => {
    expect(() =>
      verifierCoherenceTiers({
        projectRef: 'PJ002',
        projectSocid: null,
        clientLabel: 'ACME',
        expectedThirdpartyId: 7,
      }),
    ).not.toThrow()
  })

  it('laisse passer un projet sans tiers même quand le client n est pas rattaché', () => {
    expect(() =>
      verifierCoherenceTiers({
        projectRef: 'PJ002',
        projectSocid: null,
        clientLabel: 'ACME',
        expectedThirdpartyId: null,
      }),
    ).not.toThrow()
  })

  it('refuse un projet portant un tiers quand le client n est pas encore rattaché', () => {
    // L'ordre des opérations : rattacher la mission avant le client ne
    // laisse aucun tiers attendu à comparer. Ce n'est pas silencieusement
    // autorisé — le message dit quoi faire.
    expect(() =>
      verifierCoherenceTiers({
        projectRef: 'PJ001',
        projectSocid: 5,
        clientLabel: 'ACME',
        expectedThirdpartyId: null,
      }),
    ).toThrow(/PJ001.*tiers Dolibarr n° 5.*ACME.*aucun tiers Dolibarr.*Rattachez d'abord/s)
  })
})
