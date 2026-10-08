import { describe, expect, it } from 'vitest'
import { versDocumensoField } from './documenso-champs'
import type { SignatureChamp } from './connector'

const CHAMP: SignatureChamp = {
  nature: 'SIGNATURE',
  ancre: '[[cra:signature]]',
  page: 2,
  x: 200,
  y: 100,
  largeur: 148,
  hauteur: 34,
  pageLargeur: 842,
  pageHauteur: 595,
}

describe('versDocumensoField', () => {
  it('retourne l’axe vertical : le PDF compte depuis le bas, Documenso depuis le haut', () => {
    // L'oubli le plus coûteux du lot : la signature se poserait à la même
    // distance de l'autre bord, c'est-à-dire ailleurs.
    const f = versDocumensoField(CHAMP)
    // Le champ va de 100 à 134 points au-dessus du bas de page. Son haut est
    // donc à 595 − 134 = 461 points sous le haut de page.
    expect(f.positionY).toBeCloseTo((461 / 595) * 100, 2)
  })

  it('convertit en pourcentages de la page, pas en points', () => {
    const f = versDocumensoField(CHAMP)
    expect(f.positionX).toBeCloseTo((200 / 842) * 100, 2)
    expect(f.width).toBeCloseTo((148 / 842) * 100, 2)
    expect(f.height).toBeCloseTo((34 / 595) * 100, 2)
  })

  it('garde la page et la nature du champ', () => {
    expect(versDocumensoField(CHAMP).page).toBe(2)
    expect(versDocumensoField({ ...CHAMP, nature: 'DATE' }).type).toBe('DATE')
  })

  it('rend un champ entièrement dans la page', () => {
    const f = versDocumensoField(CHAMP)
    expect(f.positionX + f.width).toBeLessThanOrEqual(100)
    expect(f.positionY + f.height).toBeLessThanOrEqual(100)
  })

  it('refuse une page sans dimension plutôt que de diviser par zéro', () => {
    expect(() => versDocumensoField({ ...CHAMP, pageHauteur: 0 })).toThrow(/dimension/i)
  })

  it('désigne le seul fichier téléversé, par son index', () => {
    const champ = versDocumensoField({
      nature: 'SIGNATURE', ancre: '[[cra:signature]]', page: 1,
      x: 0, y: 0, largeur: 10, hauteur: 10, pageLargeur: 842, pageHauteur: 595,
    })
    expect(champ.identifier).toBe(0)
  })
})
