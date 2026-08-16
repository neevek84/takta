import { describe, it, expect } from 'vitest'
import {
  entryBounds,
  minutesBetween,
  slotDurationMinutes,
  crossesMidnight,
  slotInterval,
  type Slot,
} from './slots'

const matin: Slot = { id: 'm', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 }
const nuit: Slot = { id: 'n', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 }

describe('crossesMidnight', () => {
  it('est faux pour un créneau de journée', () => {
    expect(crossesMidnight(matin)).toBe(false)
  })

  it('est vrai quand la fin est avant le début', () => {
    expect(crossesMidnight(nuit)).toBe(true)
  })
})

describe('slotDurationMinutes', () => {
  it('calcule une durée de journée', () => {
    expect(slotDurationMinutes(matin)).toBe(240)
  })

  it('calcule une durée franchissant minuit', () => {
    // 22:00 -> 06:00 = 8 h
    expect(slotDurationMinutes(nuit)).toBe(480)
  })
})

describe('slotInterval', () => {
  it('reste sur le même jour pour un créneau de journée', () => {
    const { start, end } = slotInterval(matin, new Date('2026-03-12T00:00:00Z'))
    expect(start.toISOString()).toBe('2026-03-12T09:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-12T13:00:00.000Z')
  })

  it('déborde sur le lendemain quand le créneau franchit minuit', () => {
    const { start, end } = slotInterval(nuit, new Date('2026-03-12T00:00:00Z'))
    expect(start.toISOString()).toBe('2026-03-12T22:00:00.000Z')
    expect(end.toISOString()).toBe('2026-03-13T06:00:00.000Z')
  })
})

describe('minutesBetween', () => {
  it('compte les minutes entre deux bornes de la même journée', () => {
    expect(minutesBetween(540, 780)).toBe(240)
  })

  // Le porteur travaille parfois la nuit : une fin antérieure au début n'est
  // pas une erreur de saisie, c'est un bloc qui franchit minuit.
  it('franchit minuit quand la fin précède le début', () => {
    expect(minutesBetween(1320, 360)).toBe(480)
  })

  it('rend une journée entière quand les deux bornes coïncident', () => {
    expect(minutesBetween(540, 540)).toBe(1440)
  })

  it('donne la même durée qu un créneau', () => {
    const nuit: Slot = { id: 'n', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 }
    expect(minutesBetween(nuit.startMinute, nuit.endMinute)).toBe(slotDurationMinutes(nuit))
  })
})

// Les bornes que le chemin d'écriture **fige** sur une saisie. Elles étaient
// jusqu'ici recalculées à chaque lecture, au moment de construire le bloc
// d'agenda : redéfinir « Matin » en administration déplaçait alors des
// journées déjà saisies, y compris sur un CRA validé.
describe('entryBounds', () => {
  const MATIN: Slot = { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 }
  const NUIT: Slot = { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 }

  const journee = { journeeDebutMinute: 540, journeeFinMinute: 1080 }

  it('sans créneau, démarre à la plage et dure exactement le temps saisi', () => {
    expect(entryBounds({ minutes: 480, slot: null, ...journee })).toEqual({
      startMinute: 540,
      endMinute: 1020,
    })
  })

  it('sans créneau, couvre la plage entière quand la journée vaut la plage', () => {
    expect(entryBounds({ minutes: 540, slot: null, ...journee })).toEqual({
      startMinute: 540,
      endMinute: 1080,
    })
  })

  it('sans créneau, ne déborde jamais de la plage', () => {
    expect(entryBounds({ minutes: 660, slot: null, ...journee })).toEqual({
      startMinute: 540,
      endMinute: 1080,
    })
  })

  it('sans créneau, suit une plage journée décalée', () => {
    expect(
      entryBounds({
        minutes: 240,
        slot: null,
        journeeDebutMinute: 480,
        journeeFinMinute: 960,
      }),
    ).toEqual({ startMinute: 480, endMinute: 720 })
  })

  it('prend les bornes du créneau, pas la plage par défaut', () => {
    expect(entryBounds({ minutes: 240, slot: MATIN, ...journee })).toEqual({
      startMinute: 540,
      endMinute: 780,
    })
  })

  it('ignore la durée saisie quand un créneau est choisi', () => {
    expect(entryBounds({ minutes: 60, slot: MATIN, ...journee })).toEqual({
      startMinute: 540,
      endMinute: 780,
    })
  })

  it('reporte un créneau qui franchit minuit sans le replier', () => {
    expect(entryBounds({ minutes: 480, slot: NUIT, ...journee })).toEqual({
      startMinute: 1320,
      endMinute: 360,
    })
  })

  it('ramène une fin à minuit dans la plage 0-1439', () => {
    // Une plage qui va jusqu'à 24 h : 1440 n'est pas une minute du jour.
    const bornes = entryBounds({
      minutes: 900,
      slot: null,
      journeeDebutMinute: 540,
      journeeFinMinute: 1440,
    })
    expect(bornes).toEqual({ startMinute: 540, endMinute: 0 })
    // Et la durée reste celle qu'on attend : minuit ferme la journée.
    expect(minutesBetween(bornes.startMinute, bornes.endMinute)).toBe(900)
  })
})
