import { describe, it, expect } from 'vitest'
import { buildMonthDays, saisiesParJour, shiftMonth } from './build'
import { centiemesParFacteur } from '../time/units'

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

describe('saisiesParJour', () => {
  // Volontairement un regroupement, jamais une somme de minutes : chaque
  // saisie porte le facteur figé à son écriture, et des minutes écrites à
  // 420 min/jour ne s'additionnent pas à des minutes écrites à 600. C'est
  // `centiemesParFacteur` — jamais ce module — qui sait les totaliser.
  it('rassemble toutes lignes confondues sans écraser les facteurs', () => {
    const parJour = saisiesParJour([
      { date: '2026-03-12', minutes: 240, minutesParJour: 480 },
      { date: '2026-03-12', minutes: 300, minutesParJour: 600 },
      { date: '2026-03-13', minutes: 480, minutesParJour: 480 },
    ])
    expect(parJour.get('2026-03-12')).toEqual([
      { minutes: 240, minutesParJour: 480 },
      { minutes: 300, minutesParJour: 600 },
    ])
    expect(parJour.get('2026-03-13')).toEqual([{ minutes: 480, minutesParJour: 480 }])
  })

  it('convertit chaque jour au facteur de ses saisies', () => {
    const parJour = saisiesParJour([
      { date: '2026-03-12', minutes: 240, minutesParJour: 480 },
      { date: '2026-03-12', minutes: 300, minutesParJour: 600 },
    ])
    // 50 + 50 centièmes. La somme brute (540 min) convertie en une fois
    // donnerait 113 à 480 ou 90 à 600 : ni l'une ni l'autre n'est le total.
    expect(centiemesParFacteur(parJour.get('2026-03-12') ?? [])).toBe(100)
  })

  it('renvoie une table vide sans saisie', () => {
    expect(saisiesParJour([]).size).toBe(0)
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

  it('gère un décalage négatif qui fait passer le total sous zéro', () => {
    // year*12 + (m-1) + delta devient négatif : le '%' de JS rendrait un
    // reste négatif ('-1-00') sans le correctif du modulo positif.
    expect(shiftMonth('2000-01', -24001)).toBe('-0001-12')
  })

  it('zero-pade l année de sortie même quand elle devient nulle ou négative', () => {
    expect(shiftMonth('0001-01', -1)).toBe('0000-12')
  })

  it('reste correct sur un grand décalage négatif qui ne descend pas sous l an zéro', () => {
    expect(shiftMonth('2026-01', -25)).toBe('2023-12')
  })
})
