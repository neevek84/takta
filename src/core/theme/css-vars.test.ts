import { describe, it, expect } from 'vitest'
import { cssVarName, themeToCssVars, themeStylesheet } from './css-vars'
import {
  THEME_KREATIVPM,
  THEME_CLAIR,
  THEME_SOMBRE,
  THEME_TOKEN_KEYS,
  DEFAULT_THEME_CONFIG,
  type ThemeConfig,
} from './tokens'

describe('cssVarName', () => {
  it('passe du camelCase au kebab-case', () => {
    expect(cssVarName('page')).toBe('--color-page')
    expect(cssVarName('accentDark')).toBe('--color-accent-dark')
    expect(cssVarName('offStrong')).toBe('--color-off-strong')
    expect(cssVarName('successEdge')).toBe('--color-success-edge')
  })

  it('ne produit jamais deux fois le même nom', () => {
    const noms = THEME_TOKEN_KEYS.map(cssVarName)
    expect(new Set(noms).size).toBe(noms.length)
  })
})

describe('themeToCssVars', () => {
  it('produit une variable par jeton', () => {
    const vars = themeToCssVars(THEME_KREATIVPM)
    expect(Object.keys(vars)).toHaveLength(THEME_TOKEN_KEYS.length)
    expect(vars['--color-page']).toBe('#faf5ed')
    expect(vars['--color-accent-dark']).toBe('#b57730')
    expect(vars['--color-off-strong']).toBe('#e4dccc')
  })

  it('rend une palette différente pour un thème différent', () => {
    expect(themeToCssVars(THEME_CLAIR)['--color-page']).toBe('#f6f6f5')
    expect(themeToCssVars(THEME_SOMBRE)['--color-page']).toBe('#202329')
  })

  it('n émet que des noms de variables CSS', () => {
    for (const nom of Object.keys(themeToCssVars(THEME_KREATIVPM))) {
      expect(nom).toMatch(/^--color-[a-z-]+$/)
    }
  })
})

const CLAIR_SEUL: ThemeConfig = { ...DEFAULT_THEME_CONFIG, mode: 'clair' }
const SOMBRE_SEUL: ThemeConfig = { ...DEFAULT_THEME_CONFIG, mode: 'sombre' }

describe('themeStylesheet', () => {
  it('porte les deux palettes quand le thème suit le système', () => {
    const css = themeStylesheet(DEFAULT_THEME_CONFIG)
    // Le clair par défaut, le sombre sous la requête média : c'est ce qui rend
    // la préférence du système effective sans une ligne de JavaScript, donc
    // sans le scintillement d'un thème appliqué après le premier rendu.
    expect(css).toContain(`--color-page:${THEME_CLAIR.page};`)
    expect(css).toContain('@media (prefers-color-scheme:dark)')
    const sousMedia = css.slice(css.indexOf('@media'))
    expect(sousMedia).toContain(`--color-page:${THEME_SOMBRE.page};`)
    expect(css.slice(0, css.indexOf('@media'))).not.toContain(THEME_SOMBRE.page)
  })

  it('déclare les 44 jetons de chaque palette', () => {
    const css = themeStylesheet(DEFAULT_THEME_CONFIG)
    for (const key of THEME_TOKEN_KEYS) {
      expect(css.split(`${cssVarName(key)}:`).length - 1, key).toBe(2)
    }
  })

  it('n’émet qu’une palette, et aucune requête média, sur un choix explicite', () => {
    const clair = themeStylesheet(CLAIR_SEUL)
    expect(clair).not.toContain('@media')
    expect(clair).toContain(`--color-page:${THEME_CLAIR.page};`)
    expect(clair).not.toContain(THEME_SOMBRE.page)

    const sombre = themeStylesheet(SOMBRE_SEUL)
    expect(sombre).not.toContain('@media')
    expect(sombre).toContain(`--color-page:${THEME_SOMBRE.page};`)
    expect(sombre).not.toContain(THEME_CLAIR.page)
  })

  it('accorde color-scheme au mode, pour ce que la page ne peint pas', () => {
    // Barres de défilement, champs natifs, sélecteurs de couleur : sans cette
    // déclaration ils restent clairs sur un thème sombre.
    expect(themeStylesheet(DEFAULT_THEME_CONFIG)).toContain('color-scheme:light dark;')
    expect(themeStylesheet(CLAIR_SEUL)).toContain('color-scheme:light;')
    expect(themeStylesheet(SOMBRE_SEUL)).toContain('color-scheme:dark;')
    expect(themeStylesheet(SOMBRE_SEUL)).not.toContain('color-scheme:light')
  })

  it('vise la racine avec une spécificité qui passe devant @layer theme', () => {
    expect(themeStylesheet(CLAIR_SEUL).startsWith('html:root{')).toBe(true)
  })

  it('omet une valeur hors forme au lieu de la recopier dans la page', () => {
    // Ce texte part tel quel dans un `<style>`. Le service valide en amont,
    // mais la barrière qui compte est celle qui est la plus près de la sortie.
    const empoisonne: ThemeConfig = {
      ...CLAIR_SEUL,
      clair: { ...THEME_CLAIR, page: '#fff}html{display:none' as string },
    }
    const css = themeStylesheet(empoisonne)
    expect(css).not.toContain('display:none')
    expect(css).not.toContain('--color-page:')
    // Le reste de la palette passe : une couleur corrompue n'emporte pas tout.
    expect(css).toContain(`--color-ink:${THEME_CLAIR.ink};`)
  })

  it('refuse aussi les formes CSS valides mais non hexadécimales', () => {
    const nomme: ThemeConfig = {
      ...CLAIR_SEUL,
      clair: { ...THEME_CLAIR, page: 'red' as string },
    }
    expect(themeStylesheet(nomme)).not.toContain('red')
  })
})
