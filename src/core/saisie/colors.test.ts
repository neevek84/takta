import { describe, it, expect } from 'vitest'
import { colorForLine, LINE_COLORS } from './colors'

describe('colorForLine', () => {
  it('rend la même couleur à chaque appel pour un même identifiant', () => {
    // « Une couleur qui change entre deux visites ne sert à rien. »
    const premier = colorForLine('ckz7prestation42')
    const second = colorForLine('ckz7prestation42')
    expect(second).toEqual(premier)
  })

  it('ne dépend d aucun contexte : ni ordre, ni liste, ni rang', () => {
    const seule = colorForLine('l2')
    const dansUnLot = ['l9', 'l1', 'l2', 'l7'].map((id) => colorForLine(id))[2]
    const dansLOrdreInverse = ['l7', 'l2', 'l1', 'l9'].map((id) => colorForLine(id))[1]
    expect(dansUnLot).toEqual(seule)
    expect(dansLOrdreInverse).toEqual(seule)
  })

  it('rend toujours une couleur de la palette', () => {
    for (let i = 0; i < 200; i++) {
      expect(LINE_COLORS).toContainEqual(colorForLine(`line-${i}`))
    }
  })

  it('répartit les prestations sur toute la palette', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `line-${i}`)
    const distinctes = new Set(ids.map((id) => colorForLine(id).bg))
    expect(distinctes.size).toBe(LINE_COLORS.length)
  })

  it('rend une couleur même pour un identifiant vide', () => {
    expect(LINE_COLORS).toContainEqual(colorForLine(''))
  })

  it('déclare une palette non vide, sans doublon de fond', () => {
    expect(LINE_COLORS.length).toBeGreaterThan(1)
    expect(new Set(LINE_COLORS.map((c) => c.bg)).size).toBe(LINE_COLORS.length)
  })
})
