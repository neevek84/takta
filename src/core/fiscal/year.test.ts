import { describe, it, expect } from 'vitest'
import { fiscalYearBounds, fiscalYearFromStartYear } from './year'

describe('fiscalYearBounds — exercice à cheval (avril, cas réel du projet)', () => {
  it('place août 2026 dans l exercice ouvert en avril 2026', () => {
    const fy = fiscalYearBounds('2026-08-15', 4)
    expect(fy.start).toBe('2026-04-01')
    expect(fy.end).toBe('2027-03-31')
    expect(fy.label).toBe('Exercice 2026-2027')
  })

  it('place février 2026 dans l exercice ouvert en avril 2025', () => {
    const fy = fiscalYearBounds('2026-02-10', 4)
    expect(fy.start).toBe('2025-04-01')
    expect(fy.end).toBe('2026-03-31')
    expect(fy.label).toBe('Exercice 2025-2026')
  })

  it('range le jour pivot dans l exercice qui s ouvre', () => {
    expect(fiscalYearBounds('2026-04-01', 4).start).toBe('2026-04-01')
  })

  it('range la veille du pivot dans l exercice précédent', () => {
    expect(fiscalYearBounds('2026-03-31', 4).start).toBe('2025-04-01')
  })
})

describe('fiscalYearBounds — exercice civil', () => {
  it('borne sur l année civile et nomme sans tiret', () => {
    const fy = fiscalYearBounds('2026-08-15', 1)
    expect(fy.start).toBe('2026-01-01')
    expect(fy.end).toBe('2026-12-31')
    expect(fy.label).toBe('Exercice 2026')
  })
})

describe('fiscalYearBounds — fin de mois et années bissextiles', () => {
  it('termine un exercice de mars au 28 février en année ordinaire', () => {
    expect(fiscalYearBounds('2024-05-01', 3).end).toBe('2025-02-28')
  })

  it('termine un exercice de mars au 29 février en année bissextile', () => {
    expect(fiscalYearBounds('2023-05-01', 3).end).toBe('2024-02-29')
  })
})

describe('fiscalYearBounds — les douze mois', () => {
  it('produit toujours douze mois', () => {
    for (const m of [1, 4, 7, 12]) {
      expect(fiscalYearBounds('2026-06-15', m).months).toHaveLength(12)
    }
  })

  it('ordonne les mois depuis l ouverture jusqu à la clôture', () => {
    const fy = fiscalYearBounds('2026-08-15', 4)
    expect(fy.months[0]).toBe('2026-04')
    expect(fy.months[8]).toBe('2026-12')
    expect(fy.months[9]).toBe('2027-01')
    expect(fy.months[11]).toBe('2027-03')
  })

  it('reste sur une seule année civile pour un exercice de janvier', () => {
    const fy = fiscalYearBounds('2026-08-15', 1)
    expect(fy.months[0]).toBe('2026-01')
    expect(fy.months[11]).toBe('2026-12')
  })

  it('gère une ouverture en décembre', () => {
    const fy = fiscalYearBounds('2026-08-15', 12)
    expect(fy.start).toBe('2025-12-01')
    expect(fy.end).toBe('2026-11-30')
    expect(fy.months[0]).toBe('2025-12')
    expect(fy.months[1]).toBe('2026-01')
    expect(fy.months[11]).toBe('2026-11')
  })
})

describe('fiscalYearFromStartYear', () => {
  it('donne le même résultat que fiscalYearBounds pour une date interne', () => {
    expect(fiscalYearFromStartYear(2026, 4)).toEqual(fiscalYearBounds('2026-08-15', 4))
  })

  it('permet de reculer d un exercice', () => {
    expect(fiscalYearFromStartYear(2025, 4).label).toBe('Exercice 2025-2026')
  })
})
