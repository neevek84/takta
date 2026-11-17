import { describe, it, expect } from 'vitest'
import { buildPlanningDocument, joursLisibles, type PlanningSaisie } from './document'

const journee = (date: string): PlanningSaisie => ({
  date,
  minutes: 480,
  minutesParJour: 480,
  startMinute: 540,
})
const demi = (date: string, startMinute: number): PlanningSaisie => ({
  date,
  minutes: 240,
  minutesParJour: 480,
  startMinute,
})

function doc(saisies: PlanningSaisie[], du = '2026-11-01', au = '2026-12-31') {
  return buildPlanningDocument({
    clientNom: 'ACME',
    missionLabel: 'ITSM',
    prestationLabel: 'RSI',
    periode: { du, au },
    editeLe: '2026-11-16',
    saisies,
  })
}

describe('buildPlanningDocument', () => {
  it('totalise par mois et sur la période, en centièmes', () => {
    const d = doc([journee('2026-11-24'), demi('2026-11-30', 540), journee('2026-12-08')])
    expect(d.mois).toEqual([
      { mois: '2026-11', centiemes: 150 },
      { mois: '2026-12', centiemes: 100 },
    ])
    expect(d.centiemes).toBe(250)
  })

  it('additionne les saisies d’un même jour', () => {
    const d = doc([demi('2026-11-24', 540), demi('2026-11-24', 840)])
    expect(d.jours['2026-11-24']).toEqual({ date: '2026-11-24', centiemes: 100, moment: null })
  })

  it('place une demi-journée au matin ou à l’après-midi selon son début', () => {
    const d = doc([demi('2026-11-24', 540), demi('2026-12-01', 840)])
    expect(d.jours['2026-11-24']?.moment).toBe('MATIN')
    expect(d.jours['2026-12-01']?.moment).toBe('APRES_MIDI')
  })

  it('ne dit rien du moment quand deux quarts sont de part et d’autre de midi', () => {
    const quart = (s: number): PlanningSaisie => ({
      date: '2026-11-24',
      minutes: 120,
      minutesParJour: 480,
      startMinute: s,
    })
    expect(doc([quart(540), quart(840)]).jours['2026-11-24']?.moment).toBeNull()
  })

  it('ignore ce qui déborde de la période', () => {
    const d = doc([journee('2026-10-31'), journee('2026-11-24'), journee('2027-01-04')])
    expect(Object.keys(d.jours)).toEqual(['2026-11-24'])
    expect(d.centiemes).toBe(100)
  })

  it('porte les fériés des années touchées', () => {
    const d = doc([], '2026-12-01', '2027-01-31')
    expect(d.feries['2026-12-25']).toBe('Noël')
    expect(d.feries['2027-01-01']).toBe("Jour de l'an")
  })
})

describe('joursLisibles', () => {
  it('écrit sans zéros de traîne', () => {
    expect(joursLisibles(800)).toBe('8')
    expect(joursLisibles(250)).toBe('2,5')
    expect(joursLisibles(25)).toBe('0,25')
    expect(joursLisibles(1000)).toBe('10')
  })
})
