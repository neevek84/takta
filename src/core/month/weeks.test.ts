import { describe, it, expect } from 'vitest'
import { buildWeeks } from './weeks'
import { buildMonthDays } from './build'

const OUVRES = [1, 2, 3, 4, 5]

describe('buildWeeks', () => {
  it('rend toujours des semaines de sept cases', () => {
    for (const mois of ['2026-03', '2026-06', '2026-02', '2026-12']) {
      const semaines = buildWeeks(buildMonthDays(mois, OUVRES, []))
      expect(semaines.every((s) => s.length === 7)).toBe(true)
    }
  })

  it('ne perd aucun jour du mois', () => {
    const days = buildMonthDays('2026-03', OUVRES, [])
    const aplaties = buildWeeks(days).flat().filter((c) => c !== null)
    expect(aplaties).toEqual(days)
  })

  it('cale le premier jour sur sa colonne : mars 2026 commence un dimanche', () => {
    const semaines = buildWeeks(buildMonthDays('2026-03', OUVRES, []))
    expect(semaines[0]!.slice(0, 6).every((c) => c === null)).toBe(true)
    expect(semaines[0]![6]?.date).toBe('2026-03-01')
    expect(semaines).toHaveLength(6)
  })

  it('ne laisse aucune case vide en tête d un mois commençant un lundi', () => {
    // 2026-06-01 est un lundi.
    const semaines = buildWeeks(buildMonthDays('2026-06', OUVRES, []))
    expect(semaines[0]![0]?.date).toBe('2026-06-01')
    expect(semaines).toHaveLength(5)
  })

  it('complète la dernière semaine par des cases vides', () => {
    const semaines = buildWeeks(buildMonthDays('2026-06', OUVRES, []))
    const derniere = semaines[semaines.length - 1]!
    expect(derniere[0]?.date).toBe('2026-06-29')
    expect(derniere[1]?.date).toBe('2026-06-30')
    expect(derniere.slice(2).every((c) => c === null)).toBe(true)
  })

  it('rend une liste vide sans aucun jour', () => {
    expect(buildWeeks([])).toEqual([])
  })

  it('conserve l ordre des jours à l intérieur d une semaine', () => {
    const semaines = buildWeeks(buildMonthDays('2026-06', OUVRES, []))
    expect(semaines[0]!.map((c) => c?.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
