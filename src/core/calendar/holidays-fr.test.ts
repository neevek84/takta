import { describe, it, expect } from 'vitest'
import { easterSunday, frenchHolidays } from './holidays-fr'

describe('easterSunday', () => {
  it('calcule Pâques', () => {
    expect(easterSunday(2026)).toBe('2026-04-05')
    expect(easterSunday(2027)).toBe('2027-03-28')
    expect(easterSunday(2024)).toBe('2024-03-31')
  })
})

describe('frenchHolidays', () => {
  it('renvoie onze jours fériés', () => {
    expect(frenchHolidays(2026)).toHaveLength(11)
  })

  it('contient les fériés à date fixe', () => {
    const dates = frenchHolidays(2026).map((h) => h.date)
    for (const d of [
      '2026-01-01',
      '2026-05-01',
      '2026-05-08',
      '2026-07-14',
      '2026-08-15',
      '2026-11-01',
      '2026-11-11',
      '2026-12-25',
    ]) {
      expect(dates).toContain(d)
    }
  })

  it('contient les fériés mobiles', () => {
    const dates = frenchHolidays(2026).map((h) => h.date)
    expect(dates).toContain('2026-04-06') // lundi de Pâques
    expect(dates).toContain('2026-05-14') // Ascension
    expect(dates).toContain('2026-05-25') // lundi de Pentecôte
  })

  it('renvoie les dates triées', () => {
    const dates = frenchHolidays(2026).map((h) => h.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('nomme chaque férié', () => {
    const noel = frenchHolidays(2026).find((h) => h.date === '2026-12-25')
    expect(noel!.label).toBe('Noël')
  })
})
