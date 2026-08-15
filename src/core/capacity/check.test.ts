import { describe, it, expect } from 'vitest'
import { checkCapacity } from './check'

const CAP = 480 // 1 jour à 8 h

describe('checkCapacity', () => {
  it('accepte un total sous la capacité', () => {
    const v = checkCapacity({ existingMinutes: 0, addedMinutes: 240, capacityMinutes: CAP, mode: 'BLOCAGE' })
    expect(v.ok).toBe(true)
  })

  it('accepte un total exactement égal à la capacité', () => {
    const v = checkCapacity({ existingMinutes: 240, addedMinutes: 240, capacityMinutes: CAP, mode: 'BLOCAGE' })
    expect(v.ok).toBe(true)
  })

  it('autorise deux demi-journées sur deux lignes différentes', () => {
    const v = checkCapacity({ existingMinutes: 240, addedMinutes: 240, capacityMinutes: CAP, mode: 'AVERTISSEMENT' })
    expect(v.ok).toBe(true)
  })

  it('bloque le dépassement en mode BLOCAGE', () => {
    const v = checkCapacity({ existingMinutes: 480, addedMinutes: 240, capacityMinutes: CAP, mode: 'BLOCAGE' })
    expect(v).toEqual({ ok: false, severity: 'block', totalMinutes: 720, capacityMinutes: 480 })
  })

  it('avertit sans bloquer en mode AVERTISSEMENT', () => {
    const v = checkCapacity({ existingMinutes: 480, addedMinutes: 240, capacityMinutes: CAP, mode: 'AVERTISSEMENT' })
    expect(v).toEqual({ ok: false, severity: 'warn', totalMinutes: 720, capacityMinutes: 480 })
  })

  it('ne dit jamais rien en mode DESACTIVE', () => {
    const v = checkCapacity({ existingMinutes: 4800, addedMinutes: 480, capacityMinutes: CAP, mode: 'DESACTIVE' })
    expect(v.ok).toBe(true)
  })

  it('applique la même règle un dimanche qu un mardi', () => {
    // la fonction ne connaît pas la date : c'est la garantie
    const v = checkCapacity({ existingMinutes: 480, addedMinutes: 1, capacityMinutes: CAP, mode: 'BLOCAGE' })
    expect(v.ok).toBe(false)
  })
})
