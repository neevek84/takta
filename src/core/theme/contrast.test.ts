import { describe, it, expect } from 'vitest'
import {
  parseHexColor,
  relativeLuminance,
  contrastRatio,
  formatRatio,
  AA_TEXT_RATIO,
  NON_TEXT_RATIO,
} from './contrast'

describe('parseHexColor', () => {
  it('lit une notation à six chiffres', () => {
    expect(parseHexColor('#342820')).toEqual({ r: 0x34, g: 0x28, b: 0x20 })
  })

  it('accepte les minuscules comme les majuscules', () => {
    expect(parseHexColor('#faf5ed')).toEqual(parseHexColor('#FAF5ED'))
  })

  it('refuse une notation à trois chiffres', () => {
    // Accepter #fff obligerait chaque appelant à normaliser avant de comparer
    // deux jetons ; une seule forme canonique évite toute ambiguïté.
    expect(() => parseHexColor('#fff')).toThrow()
  })

  it('refuse ce qui n est pas une couleur', () => {
    expect(() => parseHexColor('FAF5ED')).toThrow()
    expect(() => parseHexColor('#GGGGGG')).toThrow()
    expect(() => parseHexColor('rouge')).toThrow()
    expect(() => parseHexColor('')).toThrow()
  })
})

describe('relativeLuminance', () => {
  it('donne 0 pour le noir et 1 pour le blanc', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#FFFFFF')).toBe(1)
  })

  it('applique la correction gamma, pas une moyenne linéaire', () => {
    // Un gris à mi-course (128/255 = 0,502) ne rend pas 0,5 de luminance :
    // la courbe sRGB le ramène à ~0,216. Une implémentation qui rendrait 0,5
    // aurait sauté la linéarisation.
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 4)
  })
})

describe('contrastRatio', () => {
  it('donne 21 entre le noir et le blanc', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10)
  })

  it('donne 1 entre une couleur et elle-même', () => {
    expect(contrastRatio('#342820', '#342820')).toBeCloseTo(1, 10)
  })

  it('est symétrique', () => {
    expect(contrastRatio('#D4943F', '#FAF5ED')).toBeCloseTo(
      contrastRatio('#FAF5ED', '#D4943F'),
      10,
    )
  })

  it('encadre le seuil AA sur les valeurs de référence WCAG', () => {
    // #767676 sur blanc est le gris le plus clair qui passe AA ; #777777 échoue.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.5422, 4)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.4781, 4)
    expect(contrastRatio('#767676', '#FFFFFF')).toBeGreaterThanOrEqual(AA_TEXT_RATIO)
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(AA_TEXT_RATIO)
  })

  it('confirme par calcul les couples que la spec énonce', () => {
    // L'or de la marque en texte sur le crème : le cas que le lot doit refuser.
    expect(contrastRatio('#D4943F', '#FAF5ED')).toBeCloseTo(2.3866, 4)
    // L'encre de la marque sur le crème : confortable.
    expect(contrastRatio('#342820', '#FAF5ED')).toBeCloseTo(13.1589, 4)
    // Le blanc sur l'or échoue ; le brun profond sur l'or passe.
    expect(contrastRatio('#FFFFFF', '#D4943F')).toBeCloseTo(2.5903, 4)
    expect(contrastRatio('#2A211A', '#D4943F')).toBeCloseTo(6.0914, 4)
  })

  it('propage le refus d une couleur illisible plutôt que de rendre NaN', () => {
    expect(() => contrastRatio('#zzzzzz', '#FFFFFF')).toThrow()
  })
})

describe('formatRatio', () => {
  it('tronque vers le bas et sépare à la française', () => {
    // Tronquer, pas arrondir : un rapport de 4,499 affiché « 4,50 » ferait
    // croire à l'utilisateur que sa palette est passée à un cheveu près
    // alors qu'elle a été refusée.
    expect(formatRatio(4.4999)).toBe('4,49')
    expect(formatRatio(2.3866)).toBe('2,38')
    expect(formatRatio(21)).toBe('21,00')
  })
})

describe('seuils', () => {
  it('expose les seuils WCAG AA', () => {
    expect(AA_TEXT_RATIO).toBe(4.5)
    expect(NON_TEXT_RATIO).toBe(3)
  })
})
