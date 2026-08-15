// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { THEME_KREATIVPM, THEME_NEUTRE, THEME_TOKEN_KEYS, TOKEN_LABELS } from '@/core/theme/tokens'

const { saveTheme, restoreDefaultTheme } = vi.hoisted(() => ({
  saveTheme: vi.fn(),
  restoreDefaultTheme: vi.fn(),
}))
vi.mock('./actions', () => ({ saveTheme, restoreDefaultTheme }))

// `vi.mock` est hissé au-dessus des imports : les server actions ne sont
// jamais chargés, seul le composant l'est.
import { ThemeForm } from './ThemeForm'

beforeEach(() => {
  saveTheme.mockReset()
  restoreDefaultTheme.mockReset()
})
afterEach(cleanup)

function champ(key: keyof typeof THEME_KREATIVPM): HTMLInputElement {
  return screen.getByLabelText(TOKEN_LABELS[key]) as HTMLInputElement
}

describe('ThemeForm', () => {
  it('expose un champ par jeton, libellé en français', () => {
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    for (const key of THEME_TOKEN_KEYS) {
      expect(champ(key).value, key).toBe(THEME_KREATIVPM[key])
    }
  })

  it('affiche la valeur hexadécimale à côté du sélecteur', () => {
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    expect(screen.getAllByText('#d4943f').length).toBeGreaterThan(0)
  })

  it('remplit les champs depuis le préréglage neutre', () => {
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    fireEvent.click(screen.getByRole('button', { name: /Neutre/ }))
    expect(champ('page').value).toBe(THEME_NEUTRE.page)
    expect(champ('accent').value).toBe(THEME_NEUTRE.accent)
  })

  it('remplit les champs depuis le préréglage KreativPM', () => {
    render(<ThemeForm theme={THEME_NEUTRE} />)
    fireEvent.click(screen.getByRole('button', { name: /KreativPM/ }))
    expect(champ('page').value).toBe(THEME_KREATIVPM.page)
  })

  it('propose un retour au défaut', () => {
    render(<ThemeForm theme={THEME_NEUTRE} />)
    expect(screen.getByRole('button', { name: /Revenir au thème par défaut/ })).toBeDefined()
  })

  it('ne juge pas la palette lui-même', () => {
    // Aucun champ « required » ni « pattern » : la validation vit dans le
    // service. Le formulaire qui doublerait la règle la ferait diverger.
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    for (const key of THEME_TOKEN_KEYS) {
      expect(champ(key).required, key).toBe(false)
    }
  })
})
