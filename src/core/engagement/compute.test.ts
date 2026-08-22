import { describe, it, expect } from 'vitest'
import { computeEngagement, cumulerEngagements, detaillerEngagement } from './compute'

const J8 = 480
const vendu30j = 3000 // 30 jours en centièmes

describe('computeEngagement', () => {
  it('ventile réalisé et prévisionnel', () => {
    const r = computeEngagement({
      venduCentiemes: vendu30j,
      entries: [
        { kind: 'REALISE', minutes: 480 * 18, minutesParJour: J8 },
        { kind: 'PREVISIONNEL', minutes: 480 * 7, minutesParJour: J8 },
      ],
    })
    expect(r.realiseCentiemes).toBe(1800)
    expect(r.prevuCentiemes).toBe(700)
    expect(r.resteCentiemes).toBe(500)
    expect(r.depassementCentiemes).toBe(0)
  })

  it('renvoie le vendu intégral sans aucune saisie', () => {
    const r = computeEngagement({ venduCentiemes: vendu30j, entries: [] })
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
        { kind: 'REALISE', minutes: 240, minutesParJour: J8 },
        { kind: 'REALISE', minutes: 240, minutesParJour: J8 },
      ],
    })
    expect(r.realiseCentiemes).toBe(100)
  })

  it('plafonne le reste à zéro et expose le dépassement', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [{ kind: 'REALISE', minutes: 480 * 12, minutesParJour: J8 }],
    })
    expect(r.resteCentiemes).toBe(0)
    expect(r.depassementCentiemes).toBe(200)
  })

  it('compte le prévisionnel dans le dépassement', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [
        { kind: 'REALISE', minutes: 480 * 8, minutesParJour: J8 },
        { kind: 'PREVISIONNEL', minutes: 480 * 5, minutesParJour: J8 },
      ],
    })
    expect(r.depassementCentiemes).toBe(300)
  })

  it('respecte un jour à 7 h 12', () => {
    const r = computeEngagement({
      venduCentiemes: 1000,
      entries: [{ kind: 'REALISE', minutes: 432, minutesParJour: 432 }],
    })
    expect(r.realiseCentiemes).toBe(100)
  })
})

describe('facteur porté par chaque saisie', () => {
  it('convertit chaque saisie avec son propre facteur', () => {
    const r = computeEngagement({
      venduCentiemes: 3000,
      entries: [
        { kind: 'REALISE', minutes: 420, minutesParJour: 420 },
        { kind: 'REALISE', minutes: 480, minutesParJour: 480 },
      ],
    })
    // Deux journées pleines, comptées à leurs facteurs respectifs.
    expect(r.realiseCentiemes).toBe(200)
  })

  it('cumule avant de convertir, à facteur constant', () => {
    // 10 saisies d'une heure à 420 min/jour : 600 minutes cumulées puis
    // converties donnent 143, quand 10 conversions séparées donneraient 140.
    const entries = Array.from({ length: 10 }, () => ({
      kind: 'REALISE' as const,
      minutes: 60,
      minutesParJour: 420,
    }))
    expect(computeEngagement({ venduCentiemes: 3000, entries }).realiseCentiemes).toBe(143)
  })

  it('groupe par facteur sans mélanger les minutes', () => {
    const r = computeEngagement({
      venduCentiemes: 3000,
      entries: [
        { kind: 'REALISE', minutes: 60, minutesParJour: 420 },
        { kind: 'REALISE', minutes: 60, minutesParJour: 420 },
        { kind: 'REALISE', minutes: 60, minutesParJour: 480 },
      ],
    })
    // 120/420 = 29 (arrondi) ; 60/480 = 13 (arrondi) ; total 42.
    expect(r.realiseCentiemes).toBe(42)
  })
})

describe('detaillerEngagement', () => {
  it('coupe le réalisé en validé et en validation, et en tire le reste', () => {
    const e = detaillerEngagement({
      venduCentiemes: 2000,
      valideCentiemes: 1200,
      enValidationCentiemes: 350,
      planifieCentiemes: 300,
    })
    expect(e.consommeCentiemes).toBe(1850)
    expect(e.resteCentiemes).toBe(150)
    expect(e.depassementCentiemes).toBe(0)
  })

  it('rend un dépassement plutôt qu un reste négatif', () => {
    const e = detaillerEngagement({
      venduCentiemes: 1000,
      valideCentiemes: 500,
      enValidationCentiemes: 300,
      planifieCentiemes: 400,
    })
    expect(e.resteCentiemes).toBe(0)
    expect(e.depassementCentiemes).toBe(200)
  })
})

describe('cumulerEngagements', () => {
  it('somme les valeurs brutes, jamais les restes déjà bornés', () => {
    // Une ligne à 2,00 j de dépassement, une autre à 6,00 j de reste : la
    // somme des restes dirait 6,00, la vérité est 4,00.
    const enDepassement = detaillerEngagement({
      venduCentiemes: 1000, valideCentiemes: 500,
      enValidationCentiemes: 300, planifieCentiemes: 400,
    })
    const avecMarge = detaillerEngagement({
      venduCentiemes: 1000, valideCentiemes: 200,
      enValidationCentiemes: 100, planifieCentiemes: 100,
    })
    expect(enDepassement.resteCentiemes + avecMarge.resteCentiemes).toBe(600)

    const cumul = cumulerEngagements([enDepassement, avecMarge])
    expect(cumul.venduCentiemes).toBe(2000)
    expect(cumul.consommeCentiemes).toBe(1600)
    expect(cumul.resteCentiemes).toBe(400)
    expect(cumul.depassementCentiemes).toBe(0)
  })

  it('rend un cumul vide sans lever', () => {
    const cumul = cumulerEngagements([])
    expect(cumul.venduCentiemes).toBe(0)
    expect(cumul.resteCentiemes).toBe(0)
  })
})
