import { describe, it, expect } from 'vitest'
import { PREVU_COLOR, SAISIE_COLOR, colorForLine, couleurDAplat, LINE_COLORS } from './colors'
import {
  TEXT_PAIRS,
  THEME_PRESETS,
  THEME_TOKEN_KEYS,
  type ThemeTokens,
} from '@/core/theme/tokens'
import { AA_TEXT_RATIO, contrastRatio } from '@/core/theme/contrast'

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

describe('couleurDAplat', () => {
  it("n'attribue pas de teinte catégorielle quand il n'y a qu'une catégorie", () => {
    // Une teinte tirée au hachage ne distingue rien quand une seule prestation
    // est à l'écran : elle se lit comme une information, et n'en porte aucune.
    expect(couleurDAplat('ligne-1', false)).toBe(SAISIE_COLOR)
    expect(SAISIE_COLOR.bg).toBe('bg-saisie')
  })

  it('rend la teinte catégorielle dès que plusieurs prestations coexistent', () => {
    expect(couleurDAplat('ligne-1', true)).toEqual(colorForLine('ligne-1'))
  })

  it('rend le même aplat pour toutes les prestations en mode ligne unique', () => {
    // Sans quoi le hachage subsisterait sous une autre forme : deux prestations
    // ouvertes l'une après l'autre changeraient de teinte sans rien signifier.
    const teintes = new Set(
      ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'].map((id) => couleurDAplat(id, false).bg),
    )
    expect(teintes).toEqual(new Set(['bg-saisie']))
  })

  it('distingue bien les prestations entre elles en mode toutes prestations', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `line-${i}`)
    const distinctes = new Set(ids.map((id) => couleurDAplat(id, true).bg))
    expect(distinctes.size).toBe(LINE_COLORS.length)
  })

  it("n'emprunte pas sa teinte à la palette catégorielle", () => {
    // L'aplat de saisie n'est pas une septième catégorie : il dit « saisi »,
    // pas « celle-ci ».
    expect(LINE_COLORS).not.toContainEqual(SAISIE_COLOR)
  })
})

/**
 * Le garde-fou que le lot 1g a laissé tomber, et qui manquait de toute façon.
 *
 * Une case remplie du calendrier porte **deux** classes venues de deux
 * endroits : `text-ink` sur le bouton (`MonthCalendar`) et la teinte de
 * l'aplat sur le nœud posé dessous (`Aplat`). Le balayage de `tokens.test.ts`
 * ne peut pas les rapprocher — l'un est un littéral, l'autre une variable —,
 * si bien qu'une nouvelle teinte d'aplat entre en service sans que son couple
 * sous l'encre du chiffre soit jamais mesuré. C'est ainsi que `bg-accent` puis
 * `bg-prevu` sont arrivés sous `text-ink` : quatre préréglages sur cinq
 * rendaient un chiffre à moins de 2,1:1, et zéro anomalie était remontée.
 *
 * La liste est donc **dérivée de ce que le module expose**, jamais écrite à la
 * main : une septième teinte d'aplat entrera dans le contrôle sans qu'on y
 * pense.
 */
describe('toute teinte d’aplat tient sous l’encre du chiffre', () => {
  /** `bg-cat-a` → `catA`, `bg-off-strong` → `offStrong`. */
  const JETON_PAR_CLASSE = new Map<string, keyof ThemeTokens>(
    THEME_TOKEN_KEYS.map((k) => [`bg-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, k]),
  )

  /** Toutes les teintes qu'une case du calendrier peut recevoir. */
  const APLATS = [...LINE_COLORS, SAISIE_COLOR, PREVU_COLOR]

  it('adosse chaque teinte d’aplat à un jeton du thème', () => {
    // Sans quoi le contrôle ci-dessous se viderait en silence : une classe
    // inconnue ne formerait aucun couple, et le test resterait vert.
    expect(APLATS.length).toBeGreaterThan(6)
    for (const aplat of APLATS) {
      expect(JETON_PAR_CLASSE.get(aplat.bg), aplat.bg).toBeDefined()
    }
  })

  it('déclare le couple encre/aplat dans TEXT_PAIRS', () => {
    for (const aplat of APLATS) {
      const fond = JETON_PAR_CLASSE.get(aplat.bg)!
      expect(TEXT_PAIRS, `ink sur ${fond} (${aplat.bg})`).toContainEqual({
        text: 'ink',
        background: fond,
      })
    }
  })

  for (const preset of THEME_PRESETS) {
    it(`${preset.label} : l’encre du chiffre tient sur chaque teinte d’aplat`, () => {
      for (const aplat of APLATS) {
        const fond = JETON_PAR_CLASSE.get(aplat.bg)!
        const ratio = contrastRatio(preset.tokens.ink, preset.tokens[fond])
        expect(ratio, `ink sur ${fond} (${aplat.bg})`).toBeGreaterThanOrEqual(AA_TEXT_RATIO)
      }
    })
  }
})
