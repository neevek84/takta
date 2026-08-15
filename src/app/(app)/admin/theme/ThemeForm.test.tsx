// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import {
  DEFAULT_THEME,
  THEME_KREATIVPM,
  THEME_NEUTRE,
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
} from '@/core/theme/tokens'

const { saveTheme, restoreDefaultTheme } = vi.hoisted(() => ({
  saveTheme: vi.fn(),
  restoreDefaultTheme: vi.fn(),
}))
vi.mock('./actions', () => ({ saveTheme, restoreDefaultTheme }))

// `vi.mock` est hissé au-dessus des imports : les server actions ne sont
// jamais chargés, seul le composant l'est.
import { ThemeForm } from './ThemeForm'

beforeEach(() => {
  saveTheme.mockReset().mockResolvedValue({ ok: true })
  restoreDefaultTheme.mockReset().mockResolvedValue({ ok: true })
})
afterEach(cleanup)

function champ(key: keyof typeof THEME_KREATIVPM): HTMLInputElement {
  return screen.getByLabelText(TOKEN_LABELS[key]) as HTMLInputElement
}

function soumettre(): void {
  const form = document.querySelector('form')
  if (!form) throw new Error('formulaire introuvable')
  fireEvent.submit(form)
}

function boutonRetourDefaut(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Revenir au thème par défaut/ }) as HTMLButtonElement
}

describe('ThemeForm', () => {
  it('expose un champ par jeton, libellé en français', () => {
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    for (const key of THEME_TOKEN_KEYS) {
      expect(champ(key).value, key).toBe(THEME_KREATIVPM[key])
    }
  })

  it('nomme chaque champ exactement comme le jeton qu’il porte', () => {
    // Contrat avec `actions.ts`, qui fait `formData.get(key)` pour chaque
    // `THEME_TOKEN_KEYS`. Il tient à un seul attribut : le préfixer suffit à
    // faire refuser tout enregistrement par 26 « couleur requise ».
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    for (const key of THEME_TOKEN_KEYS) {
      expect(champ(key).name, key).toBe(key)
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

  it('ne juge pas la palette lui-même', () => {
    // Aucun `required`, aucun `pattern` : la validation vit dans le service.
    // Le formulaire qui doublerait la règle la ferait diverger.
    render(<ThemeForm theme={THEME_KREATIVPM} />)
    for (const key of THEME_TOKEN_KEYS) {
      expect(champ(key).getAttribute('required'), key).toBeNull()
      expect(champ(key).getAttribute('pattern'), key).toBeNull()
    }
  })

  describe('refus du serveur', () => {
    it('affiche le refus dans un bandeau d’alerte, avec ses messages', async () => {
      saveTheme.mockResolvedValue({
        ok: false,
        errors: ['Le couple « encre » sur « fond de page » n’atteint que 2,38:1.'],
      })
      render(<ThemeForm theme={THEME_KREATIVPM} />)

      soumettre()

      const bandeau = await screen.findByRole('alert')
      expect(bandeau.textContent).toContain('2,38:1')
      expect(bandeau.textContent).toContain('encre')
    })

    it('confirme l’enregistrement accepté', async () => {
      render(<ThemeForm theme={THEME_KREATIVPM} />)

      soumettre()

      expect((await screen.findByRole('status')).textContent).toContain('enregistrée')
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  describe('retour au thème par défaut', () => {
    it('appelle l’action et repeint les champs une fois le succès obtenu', async () => {
      render(<ThemeForm theme={THEME_NEUTRE} />)

      fireEvent.click(boutonRetourDefaut())

      await waitFor(() => expect(restoreDefaultTheme).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(champ('page').value).toBe(DEFAULT_THEME.page))
    })

    it('n’affirme rien que la base n’ait fait : échec ⇒ champs inchangés et alerte', async () => {
      // Session expirée entre le chargement et le clic. L'écran ne doit pas
      // se repeindre au défaut pendant que la base garde l'ancienne palette.
      restoreDefaultTheme.mockResolvedValue({
        ok: false,
        errors: ['Vérifiez que votre session est toujours ouverte, puis réessayez.'],
      })
      render(<ThemeForm theme={THEME_NEUTRE} />)

      fireEvent.click(boutonRetourDefaut())

      const bandeau = await screen.findByRole('alert')
      expect(bandeau.textContent).toContain('n’a pas été restauré')
      expect(bandeau.textContent).toContain('votre session')
      expect(champ('page').value).toBe(THEME_NEUTRE.page)
      expect(champ('page').value).not.toBe(DEFAULT_THEME.page)
    })

    it('désactive le bouton pendant l’appel', async () => {
      let libere: (v: { ok: true }) => void = () => {}
      restoreDefaultTheme.mockReturnValue(
        new Promise<{ ok: true }>((resolve) => {
          libere = resolve
        }),
      )
      render(<ThemeForm theme={THEME_NEUTRE} />)

      fireEvent.click(boutonRetourDefaut())

      await waitFor(() => expect(boutonRetourDefaut().disabled).toBe(true))
      libere({ ok: true })
      await waitFor(() => expect(boutonRetourDefaut().disabled).toBe(false))
    })
  })
})
