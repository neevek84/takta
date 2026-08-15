import { describe, it, expect } from 'vitest'
import { cssVarName, themeToCssVars } from './css-vars'
import { THEME_KREATIVPM, THEME_NEUTRE, THEME_TOKEN_KEYS } from './tokens'

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
    expect(themeToCssVars(THEME_NEUTRE)['--color-page']).toBe('#f6f6f5')
  })

  it('n émet que des noms de variables CSS', () => {
    for (const nom of Object.keys(themeToCssVars(THEME_KREATIVPM))) {
      expect(nom).toMatch(/^--color-[a-z-]+$/)
    }
  })
})
