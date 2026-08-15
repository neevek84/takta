import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_THEME, THEME_TOKEN_KEYS } from '@/core/theme/tokens'
import { cssVarName } from '@/core/theme/css-vars'

const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')

function valeurDeclaree(variable: string): string | null {
  const m = new RegExp(`${variable}\\s*:\\s*([^;]+);`).exec(css)
  return m === null ? null : m[1]!.trim()
}

describe('globals.css', () => {
  it('déclare chaque jeton avec la valeur du thème par défaut', () => {
    for (const key of THEME_TOKEN_KEYS) {
      expect(valeurDeclaree(cssVarName(key)), key).toBe(DEFAULT_THEME[key])
    }
  })

  it('n utilise pas @theme inline', () => {
    // `@theme inline` substituerait la valeur dans chaque utilitaire : le
    // thème paramétrable deviendrait inopérant, et personne ne s'en
    // apercevrait avant de changer une couleur en production.
    expect(css).not.toMatch(/@theme\s+inline/)
  })

  it('déclare un état de focus visible', () => {
    expect(css).toContain(':focus-visible')
    expect(css).toContain('var(--color-focus)')
  })

  it('déclare les motifs qui distinguent sans la couleur', () => {
    for (const motif of ['pattern-stripes', 'pattern-dots', 'pattern-hatch']) {
      expect(css).toContain(motif)
    }
  })

  it('déclare une cible tactile de 44 points', () => {
    expect(css).toContain('touch-target')
    expect(css).toContain('2.75rem')
  })
})
