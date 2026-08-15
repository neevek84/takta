import { describe, it, expect } from 'vitest'
import { computeEngagement } from './compute'

const J8 = 480
const vendu30j = 3000 // 30 jours en centièmes

describe('computeEngagement', () => {
  it('ventile réalisé et prévisionnel', () => {
    const r = computeEngagement({
      venduCentiemes: vendu30j,
      entries: [
        { kind: 'REALISE', minutes: 480 * 18 },
        { kind: 'PREVISIONNEL', minutes: 480 * 7 },
      ],
      minutesParJour: J8,
    })
    expect(r.realiseCentiemes).toBe(1800)
    expect(r.prevuCentiemes).toBe(700)
    expect(r.resteCentiemes).toBe(500)
    expect(r.depassementCentiemes).toBe(0)
  })

  it('renvoie le vendu intégral sans aucune saisie', () => {
    const r = computeEngagement({ venduCentiemes: vendu30j, entries: [], minutesParJour: J8 })
    expect(r).toEqual({
      venduCentiemes: 3000,
      realiseCentiemes: 0,
      prevuCentiemes: 0,
      resteCentiemes: 3000,
      depassementCentiemes: 0,
    })
  })

  it('agrège les demi-journées', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [
        { kind: 'REALISE', minutes: 240 },
        { kind: 'REALISE', minutes: 240 },
      ],
      minutesParJour: J8,
    })
    expect(r.realiseCentiemes).toBe(100)
  })

  it('plafonne le reste à zéro et expose le dépassement', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [{ kind: 'REALISE', minutes: 480 * 12 }],
      minutesParJour: J8,
    })
    expect(r.resteCentiemes).toBe(0)
    expect(r.depassementCentiemes).toBe(200)
  })

  it('compte le prévisionnel dans le dépassement', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [
        { kind: 'REALISE', minutes: 480 * 8 },
        { kind: 'PREVISIONNEL', minutes: 480 * 5 },
      ],
      minutesParJour: J8,
    })
    expect(r.depassementCentiemes).toBe(300)
  })

  it('respecte un jour à 7 h 12', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [{ kind: 'REALISE', minutes: 432 }],
      minutesParJour: 432,
    })
    expect(r.realiseCentiemes).toBe(100)
  })
})
