import { describe, it, expect } from 'vitest'
import {
  dateFr,
  erreurDePeriode,
  estDateIso,
  moisDeLaPeriode,
  periodePredefinie,
} from './periode'

describe('periodePredefinie', () => {
  it('ouvre au premier du mois et ferme au dernier jour du n-ième mois', () => {
    expect(periodePredefinie('MOIS', '2027-02')).toEqual({ du: '2027-02-01', au: '2027-02-28' })
    expect(periodePredefinie('TROIS_MOIS', '2026-11')).toEqual({ du: '2026-11-01', au: '2027-01-31' })
    expect(periodePredefinie('SIX_MOIS', '2026-11')).toEqual({ du: '2026-11-01', au: '2027-04-30' })
    expect(periodePredefinie('DOUZE_MOIS', '2027-01')).toEqual({ du: '2027-01-01', au: '2027-12-31' })
  })

  it('tient compte des années bissextiles', () => {
    expect(periodePredefinie('MOIS', '2028-02').au).toBe('2028-02-29')
  })
})

describe('moisDeLaPeriode', () => {
  it('liste les mois touchés, à cheval sur deux années', () => {
    expect(moisDeLaPeriode({ du: '2026-11-15', au: '2027-02-03' })).toEqual([
      '2026-11', '2026-12', '2027-01', '2027-02',
    ])
  })
})

describe('erreurDePeriode', () => {
  it('accepte une période valide', () => {
    expect(erreurDePeriode({ du: '2026-11-01', au: '2027-06-30' })).toBeNull()
  })

  it('refuse une date qui n’existe pas', () => {
    expect(estDateIso('2027-02-31')).toBe(false)
    expect(erreurDePeriode({ du: '2027-02-31', au: '2027-03-31' })).toMatch(/début/)
    expect(erreurDePeriode({ du: '2027-02-01', au: '' })).toMatch(/fin/)
  })

  it('refuse une fin avant le début', () => {
    expect(erreurDePeriode({ du: '2027-03-01', au: '2027-02-28' })).toMatch(/précède/)
  })

  it('compte les mois touchés, pas la durée', () => {
    expect(erreurDePeriode({ du: '2027-01-01', au: '2027-12-31' })).toBeNull()
    expect(erreurDePeriode({ du: '2027-01-15', au: '2028-01-14' })).toMatch(/12 mois/)
  })
})

describe('dateFr', () => {
  it('écrit la date à la française', () => {
    expect(dateFr('2026-11-24')).toBe('24/11/2026')
  })
})
