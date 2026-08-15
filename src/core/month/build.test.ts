import { describe, it, expect } from 'vitest'
import { buildMonthDays, dailyTotals, shiftMonth } from './build'

describe('buildMonthDays', () => {
  it('produit le bon nombre de jours', () => {
    expect(buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])).toHaveLength(31)
    expect(buildMonthDays('2026-02', [1, 2, 3, 4, 5], [])).toHaveLength(28)
    expect(buildMonthDays('2024-02', [1, 2, 3, 4, 5], [])).toHaveLength(29)
  })

  it('marque les jours ouvrés selon les réglages', () => {
    const days = buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])
    // 2026-03-01 est un dimanche
    expect(days[0]!.date).toBe('2026-03-01')
    expect(days[0]!.dayOfWeek).toBe(7)
    expect(days[0]!.isWorking).toBe(false)
    // 2026-03-02 est un lundi
    expect(days[1]!.isWorking).toBe(true)
  })

  it('rend le samedi ouvré quand il est activé', () => {
    const days = buildMonthDays('2026-03', [1, 2, 3, 4, 5, 6], [])
    const samedi = days.find((d) => d.date === '2026-03-07')
    expect(samedi!.dayOfWeek).toBe(6)
    expect(samedi!.isWorking).toBe(true)
  })

  it('marque les fériés sans les rendre non saisissables', () => {
    const days = buildMonthDays('2026-05', [1, 2, 3, 4, 5], ['2026-05-01'])
    const premierMai = days.find((d) => d.date === '2026-05-01')
    expect(premierMai!.isHoliday).toBe(true)
  })
})

describe('dailyTotals', () => {
  it('agrège toutes lignes confondues', () => {
    const totals = dailyTotals([
      { date: '2026-03-12', minutes: 240 },
      { date: '2026-03-12', minutes: 240 },
      { date: '2026-03-13', minutes: 480 },
    ])
    expect(totals.get('2026-03-12')).toBe(480)
    expect(totals.get('2026-03-13')).toBe(480)
  })

  it('renvoie une table vide sans saisie', () => {
    expect(dailyTotals([]).size).toBe(0)
  })
})

describe('shiftMonth', () => {
  it('avance d un mois', () => {
    expect(shiftMonth('2026-08', 1)).toBe('2026-09')
  })

  it('recule d un mois', () => {
    expect(shiftMonth('2026-08', -1)).toBe('2026-07')
  })

  it('franchit décembre vers janvier', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('franchit janvier vers décembre', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })

  it('accepte un décalage de plusieurs mois', () => {
    expect(shiftMonth('2026-08', 12)).toBe('2027-08')
    expect(shiftMonth('2026-08', -12)).toBe('2025-08')
    expect(shiftMonth('2026-02', -14)).toBe('2024-12')
  })

  it('renvoie le mois inchangé pour un décalage nul', () => {
    expect(shiftMonth('2026-08', 0)).toBe('2026-08')
  })
})
