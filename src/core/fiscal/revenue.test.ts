import { describe, it, expect } from 'vitest'
import {
  caFromEntries,
  exerciceProgress,
  tjmMoyenPondere,
  resteEnCentiemes,
} from './revenue'

// Deux lignes de la même mission, tarifées différemment — le cas réel.
const LINES = [
  { id: 'jour', tjmCents: 80000, minutesParJour: 480 },
  { id: 'nuit', tjmCents: 120000, minutesParJour: 480 },
]

describe('caFromEntries', () => {
  it('valorise une journée pleine au TJM de sa ligne', () => {
    expect(caFromEntries([{ lineId: 'jour', minutes: 480 }], LINES)).toBe(80000)
  })

  it('valorise une demi-journée à la moitié', () => {
    expect(caFromEntries([{ lineId: 'jour', minutes: 240 }], LINES)).toBe(40000)
  })

  it('applique à chaque entrée le TJM de SA ligne', () => {
    const ca = caFromEntries(
      [
        { lineId: 'jour', minutes: 480 },
        { lineId: 'nuit', minutes: 480 },
      ],
      LINES,
    )
    expect(ca).toBe(200000)
  })

  it('respecte un minutesParJour surchargé par ligne', () => {
    const ca = caFromEntries([{ lineId: 'sept', minutes: 420 }], [
      { id: 'sept', tjmCents: 70000, minutesParJour: 420 },
    ])
    expect(ca).toBe(70000)
  })

  it('renvoie zéro sans entrée', () => {
    expect(caFromEntries([], LINES)).toBe(0)
  })

  it('ignore une entrée dont la ligne est inconnue', () => {
    expect(caFromEntries([{ lineId: 'fantome', minutes: 480 }], LINES)).toBe(0)
  })

  it('ne dérive pas sur un cumul de nombreuses demi-journées', () => {
    const entries = Array.from({ length: 300 }, () => ({ lineId: 'jour', minutes: 240 }))
    expect(caFromEntries(entries, LINES)).toBe(300 * 40000)
  })
})

describe('exerciceProgress', () => {
  it('calcule le reste à vendre', () => {
    const p = exerciceProgress(15_000_000, 4_000_000, 3_000_000)
    expect(p.resteAVendreCents).toBe(8_000_000)
    expect(p.depassementCents).toBe(0)
  })

  it('plafonne le reste à zéro et expose le dépassement', () => {
    const p = exerciceProgress(10_000_000, 8_000_000, 5_000_000)
    expect(p.resteAVendreCents).toBe(0)
    expect(p.depassementCents).toBe(3_000_000)
  })

  it('traite l égalité stricte comme un reste nul sans dépassement', () => {
    const p = exerciceProgress(10_000_000, 6_000_000, 4_000_000)
    expect(p.resteAVendreCents).toBe(0)
    expect(p.depassementCents).toBe(0)
  })

  it('renvoie un taux de couverture nul quand l objectif n est pas défini', () => {
    const p = exerciceProgress(0, 4_000_000, 0)
    expect(p.tauxCouverture).toBe(0)
    expect(p.resteAVendreCents).toBe(0)
  })

  it('calcule le taux sur le réalisé plus le prévu', () => {
    const p = exerciceProgress(10_000_000, 4_000_000, 1_000_000)
    expect(p.tauxCouverture).toBeCloseTo(0.5, 10)
  })
})

describe('tjmMoyenPondere', () => {
  it('pondère par les jours vendus, pas par le nombre de lignes', () => {
    // Moyenne arithmétique = 100 000. Pondérée = 90 000.
    const moyen = tjmMoyenPondere([
      { tjmCents: 80000, soldCentiemes: 3000 },
      { tjmCents: 120000, soldCentiemes: 1000 },
    ])
    expect(moyen).toBe(90000)
  })

  it('renvoie le TJM tel quel avec une seule ligne', () => {
    expect(tjmMoyenPondere([{ tjmCents: 80000, soldCentiemes: 3000 }])).toBe(80000)
  })

  it('renvoie null sans aucune ligne', () => {
    expect(tjmMoyenPondere([])).toBeNull()
  })

  it('renvoie null quand aucun jour n est vendu', () => {
    expect(tjmMoyenPondere([{ tjmCents: 80000, soldCentiemes: 0 }])).toBeNull()
  })
})

describe('resteEnCentiemes', () => {
  it('traduit un reste en centièmes de jour', () => {
    // 42 000 € à 800 € par jour = 52,5 jours
    expect(resteEnCentiemes(4_200_000, 80000)).toBe(5250)
  })

  it('renvoie null sans TJM moyen', () => {
    expect(resteEnCentiemes(4_200_000, null)).toBeNull()
  })

  it('renvoie null sur un TJM moyen nul', () => {
    expect(resteEnCentiemes(4_200_000, 0)).toBeNull()
  })
})
