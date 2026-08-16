import { describe, it, expect } from 'vitest'
import {
  minutesToCentiemes,
  centiemesToMinutes,
  centiemesParFacteur,
  millicentiemesParFacteur,
  formatQuantity,
  parseQuantity,
} from './units'

const J8 = 480 // 8 h
const J7_12 = 432 // 7 h 12

describe('minutesToCentiemes', () => {
  it('convertit une journée pleine en 100 centièmes', () => {
    expect(minutesToCentiemes(480, J8)).toBe(100)
  })

  it('convertit une demi-journée en 50 centièmes', () => {
    expect(minutesToCentiemes(240, J8)).toBe(50)
  })

  it('respecte un jour à 7 h 12', () => {
    expect(minutesToCentiemes(432, J7_12)).toBe(100)
    expect(minutesToCentiemes(216, J7_12)).toBe(50)
  })

  it('arrondit à l entier le plus proche', () => {
    expect(minutesToCentiemes(1, J8)).toBe(0)
    expect(minutesToCentiemes(3, J8)).toBe(1)
  })
})

describe('centiemesToMinutes', () => {
  it('fait l aller-retour sur les valeurs rondes', () => {
    expect(centiemesToMinutes(100, J8)).toBe(480)
    expect(centiemesToMinutes(50, J8)).toBe(240)
    expect(centiemesToMinutes(100, J7_12)).toBe(432)
  })
})

describe('centiemesParFacteur', () => {
  it('ne compte rien sans saisie', () => {
    expect(centiemesParFacteur([])).toBe(0)
  })

  it('cumule les minutes d un même facteur avant de convertir', () => {
    // 213 + 213 + 174 = 600 min à 600 → 100. Converties une par une :
    // 36 + 36 + 29 = 101.
    expect(
      centiemesParFacteur([
        { minutes: 213, minutesParJour: 600 },
        { minutes: 213, minutesParJour: 600 },
        { minutes: 174, minutesParJour: 600 },
      ]),
    ).toBe(100)
  })

  it('convertit chaque facteur séparément avant de sommer les centièmes', () => {
    // 330 min à 420 → 79 ; 150 min à 600 → 25. La somme brute des minutes
    // (480) convertie en une fois donnerait 114 à 420 ou 80 à 600.
    expect(
      centiemesParFacteur([
        { minutes: 200, minutesParJour: 420 },
        { minutes: 150, minutesParJour: 600 },
        { minutes: 130, minutesParJour: 420 },
      ]),
    ).toBe(104)
  })

  it('ignore un facteur inexploitable plutôt que de rendre un infini', () => {
    // Une saisie dont la durée de journée serait nulle ne peut pas être
    // convertie : elle compte pour zéro, jamais pour `Infinity`.
    expect(
      centiemesParFacteur([
        { minutes: 240, minutesParJour: 480 },
        { minutes: 60, minutesParJour: 0 },
      ]),
    ).toBe(50)
  })
})

describe('millicentiemesParFacteur', () => {
  it('ne compte rien sans saisie', () => {
    expect(millicentiemesParFacteur([])).toBe(0)
  })

  it('sépare deux totaux que le centième confond', () => {
    // 420 et 421 minutes sur une journée de 420 valent toutes deux 100
    // centièmes une fois arrondies : au centième, la minute de trop est
    // invisible. L'unité fine la voit.
    expect(centiemesParFacteur([{ minutes: 421, minutesParJour: 420 }])).toBe(100)
    expect(millicentiemesParFacteur([{ minutes: 420, minutesParJour: 420 }])).toBe(100000)
    expect(millicentiemesParFacteur([{ minutes: 421, minutesParJour: 420 }])).toBe(100238)
  })

  it('groupe par facteur exactement comme le calcul en centièmes', () => {
    // 211 min à 420 (50 238) + 300 min à 600 (50 000) : une journée dépassée
    // d'une seule minute, que la somme des centièmes arrondis (50 + 50) ramène
    // à une journée pile.
    const saisies = [
      { minutes: 211, minutesParJour: 420 },
      { minutes: 300, minutesParJour: 600 },
    ]
    expect(centiemesParFacteur(saisies)).toBe(100)
    expect(millicentiemesParFacteur(saisies)).toBe(100238)
  })

  it('cumule les minutes d un même facteur avant de convertir', () => {
    // 130 + 131 = 261 min à 420 → 62 143. Converties une par une :
    // 30 952 + 31 190 = 62 142, un millicentième de plus par accumulation.
    expect(
      millicentiemesParFacteur([
        { minutes: 130, minutesParJour: 420 },
        { minutes: 131, minutesParJour: 420 },
      ]),
    ).toBe(62143)
  })

  it('ignore un facteur inexploitable plutôt que de rendre un infini', () => {
    expect(
      millicentiemesParFacteur([
        { minutes: 240, minutesParJour: 480 },
        { minutes: 60, minutesParJour: 0 },
      ]),
    ).toBe(50000)
  })
})

describe('formatQuantity', () => {
  it('formate en jours', () => {
    expect(formatQuantity(480, 'JOUR', J8)).toBe('1')
    expect(formatQuantity(240, 'JOUR', J8)).toBe('0,5')
    expect(formatQuantity(0, 'JOUR', J8)).toBe('')
  })

  it('formate en demi-journées comme en jours', () => {
    expect(formatQuantity(240, 'DEMI_JOUR', J8)).toBe('0,5')
  })

  it('formate en heures', () => {
    expect(formatQuantity(480, 'HEURE', J8)).toBe('8h')
    expect(formatQuantity(450, 'HEURE', J8)).toBe('7h30')
    expect(formatQuantity(0, 'HEURE', J8)).toBe('')
  })
})

describe('parseQuantity', () => {
  it('accepte la virgule et le point en jours', () => {
    expect(parseQuantity('0,5', 'JOUR', J8)).toBe(240)
    expect(parseQuantity('0.5', 'JOUR', J8)).toBe(240)
    expect(parseQuantity('1', 'JOUR', J8)).toBe(480)
  })

  it('accepte les formats horaires', () => {
    expect(parseQuantity('7h30', 'HEURE', J8)).toBe(450)
    expect(parseQuantity('8h', 'HEURE', J8)).toBe(480)
    expect(parseQuantity('8', 'HEURE', J8)).toBe(480)
  })

  it('traite le vide comme zéro', () => {
    expect(parseQuantity('', 'JOUR', J8)).toBe(0)
    expect(parseQuantity('   ', 'JOUR', J8)).toBe(0)
  })

  it('renvoie null sur une saisie invalide', () => {
    expect(parseQuantity('abc', 'JOUR', J8)).toBeNull()
    expect(parseQuantity('-1', 'JOUR', J8)).toBeNull()
  })
})
