import { describe, it, expect } from 'vitest'
import { slotDurationMinutes, crossesMidnight, slotInterval, type Slot } from './slots'

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
