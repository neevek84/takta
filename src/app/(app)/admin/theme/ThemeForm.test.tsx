// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import {
  DEFAULT_THEME_CONFIG,
  THEME_CLAIR,
  THEME_KREATIVPM,
  THEME_SOMBRE,
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
  type ThemeConfig,
  type ThemeNature,
} from '@/core/theme/tokens'

const { saveTheme, restoreDefaultTheme } = vi.hoisted(() => ({
  saveTheme: vi.fn(),
  restoreDefaultTheme: vi.fn(),
}))
vi.mock('./actions', () => ({ saveTheme, restoreDefaultTheme }))

// `vi.mock` est hissé au-dessus des imports : les server actions ne sont
// jamais chargés, seul le composant l'est.
import { ThemeForm } from './ThemeForm'

const MARQUE: ThemeConfig = { mode: 'clair', clair: THEME_KREATIVPM, sombre: THEME_SOMBRE }

beforeEach(() => {
  saveTheme.mockReset().mockResolvedValue({ ok: true })
  restoreDefaultTheme.mockReset().mockResolvedValue({ ok: true })
})
afterEach(cleanup)

function champ(nature: ThemeNature, key: keyof typeof TOKEN_LABELS): HTMLInputElement {
  return screen.getByLabelText(`${TOKEN_LABELS[key]} (thème ${nature})`) as HTMLInputElement
}

function soumettre(): void {
  const form = document.querySelector('form')
  if (!form) throw new Error('formulaire introuvable')
  fireEvent.submit(form)
}

function boutonRetourDefaut(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Revenir au thème par défaut/ }) as HTMLButtonElement
}

function modeChoisi(): string {
  const coche = screen
    .getAllByRole('radio')
    .find((r) => (r as HTMLInputElement).checked) as HTMLInputElement | undefined
  if (!coche) throw new Error('aucun mode coché')
  return coche.value
}

describe('ThemeForm', () => {
  it('expose un champ par jeton et par versant, libellé en français', () => {
    render(<ThemeForm config={MARQUE} />)
    for (const key of THEME_TOKEN_KEYS) {
      expect(champ('clair', key).value, `clair.${key}`).toBe(THEME_KREATIVPM[key])
      expect(champ('sombre', key).value, `sombre.${key}`).toBe(THEME_SOMBRE[key])
    }
  })

  it('nomme chaque champ exactement comme `actions.ts` le relit', () => {
    // Contrat avec `actions.ts`, qui fait `formData.get(`${versant}.${key}`)`.
    // Il tient à un seul attribut : le préfixer autrement suffit à faire
    // refuser tout enregistrement par 88 « couleur requise ».
    render(<ThemeForm config={MARQUE} />)
    for (const key of THEME_TOKEN_KEYS) {
      expect(champ('clair', key).name, key).toBe(`clair.${key}`)
      expect(champ('sombre', key).name, key).toBe(`sombre.${key}`)
    }
  })

  it('affiche la valeur hexadécimale à côté du sélecteur', () => {
    render(<ThemeForm config={MARQUE} />)
    expect(screen.getAllByText('#d4943f').length).toBeGreaterThan(0)
  })

  describe('mode d’application', () => {
    it('offre les trois modes et coche celui qui est enregistré', () => {
      render(<ThemeForm config={{ ...DEFAULT_THEME_CONFIG, mode: 'sombre' }} />)
      expect(screen.getAllByRole('radio')).toHaveLength(3)
      expect(modeChoisi()).toBe('sombre')
    })

    it('coche « préférence du système » quand c’est le réglage en base', () => {
      render(<ThemeForm config={DEFAULT_THEME_CONFIG} />)
      expect(modeChoisi()).toBe('systeme')
    })

    it('laisse changer de mode', () => {
      render(<ThemeForm config={DEFAULT_THEME_CONFIG} />)
      fireEvent.click(screen.getByRole('radio', { name: /Toujours sombre/ }))
      expect(modeChoisi()).toBe('sombre')
    })

    it('offre une cible tactile de 44 points sur chaque choix', () => {
      // Le mode se règle au doigt sur un téléphone : une puce radio nue fait
      // 13 points de côté.
      render(<ThemeForm config={DEFAULT_THEME_CONFIG} />)
      for (const radio of screen.getAllByRole('radio')) {
        expect(radio.closest('label')?.className).toContain('touch-target')
      }
    })

    it('transmet le mode sous le nom que l’action relit', () => {
      render(<ThemeForm config={DEFAULT_THEME_CONFIG} />)
      for (const radio of screen.getAllByRole('radio')) {
        expect((radio as HTMLInputElement).name).toBe('mode')
      }
    })
  })

  describe('préréglages', () => {
    it('ne propose un préréglage que du côté de son versant', () => {
      render(<ThemeForm config={DEFAULT_THEME_CONFIG} />)
      // KreativPM est un thème clair : le proposer dans l'emplacement sombre
      // ferait cliquer sur ce que le service refuse.
      expect(screen.getAllByRole('button', { name: /^KreativPM$/ })).toHaveLength(1)
      expect(screen.getAllByRole('button', { name: /^Sombre$/ })).toHaveLength(1)
    })

    it('remplit la palette claire depuis le préréglage KreativPM, sans toucher la sombre', () => {
      render(<ThemeForm config={DEFAULT_THEME_CONFIG} />)
      fireEvent.click(screen.getByRole('button', { name: /^KreativPM$/ }))
      expect(champ('clair', 'page').value).toBe(THEME_KREATIVPM.page)
      expect(champ('sombre', 'page').value).toBe(THEME_SOMBRE.page)
    })

    it('remplit la palette claire depuis le préréglage Clair', () => {
      render(<ThemeForm config={MARQUE} />)
      fireEvent.click(screen.getByRole('button', { name: /^Clair$/ }))
      expect(champ('clair', 'page').value).toBe(THEME_CLAIR.page)
    })
  })

  it('ne juge pas la palette lui-même', () => {
    // Aucun `required`, aucun `pattern` : la validation vit dans le service.
    // Le formulaire qui doublerait la règle la ferait diverger.
    render(<ThemeForm config={MARQUE} />)
    for (const key of THEME_TOKEN_KEYS) {
      expect(champ('clair', key).getAttribute('required'), key).toBeNull()
      expect(champ('clair', key).getAttribute('pattern'), key).toBeNull()
    }
  })

  describe('refus du serveur', () => {
    it('affiche le refus dans un bandeau d’alerte, avec ses messages', async () => {
      saveTheme.mockResolvedValue({
        ok: false,
        errors: ['Thème sombre — Le couple « encre » sur « fond de page » n’atteint que 2,38:1.'],
      })
      render(<ThemeForm config={MARQUE} />)

      soumettre()

      const bandeau = await screen.findByRole('alert')
      expect(bandeau.textContent).toContain('2,38:1')
      expect(bandeau.textContent).toContain('Thème sombre')
    })

    it('confirme l’enregistrement accepté', async () => {
      render(<ThemeForm config={MARQUE} />)

      soumettre()

      expect((await screen.findByRole('status')).textContent).toContain('enregistrée')
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  describe('retour au thème par défaut', () => {
    it('appelle l’action et repeint les deux palettes une fois le succès obtenu', async () => {
      render(<ThemeForm config={MARQUE} />)

      fireEvent.click(boutonRetourDefaut())

      await waitFor(() => expect(restoreDefaultTheme).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(champ('clair', 'page').value).toBe(THEME_CLAIR.page))
      expect(champ('sombre', 'page').value).toBe(THEME_SOMBRE.page)
      expect(modeChoisi()).toBe('systeme')
    })

    it('n’affirme rien que la base n’ait fait : échec ⇒ champs inchangés et alerte', async () => {
      // Session expirée entre le chargement et le clic. L'écran ne doit pas
      // se repeindre au défaut pendant que la base garde l'ancienne palette.
      restoreDefaultTheme.mockResolvedValue({
        ok: false,
        errors: ['Vérifiez que votre session est toujours ouverte, puis réessayez.'],
      })
      render(<ThemeForm config={MARQUE} />)

      fireEvent.click(boutonRetourDefaut())

      const bandeau = await screen.findByRole('alert')
      expect(bandeau.textContent).toContain('n’a pas été restauré')
      expect(bandeau.textContent).toContain('votre session')
      expect(champ('clair', 'page').value).toBe(THEME_KREATIVPM.page)
      expect(champ('clair', 'page').value).not.toBe(THEME_CLAIR.page)
      expect(modeChoisi()).toBe('clair')
    })

    it('désactive le bouton pendant l’appel', async () => {
      let libere: (v: { ok: true }) => void = () => {}
      restoreDefaultTheme.mockReturnValue(
        new Promise<{ ok: true }>((resolve) => {
          libere = resolve
        }),
      )
      render(<ThemeForm config={MARQUE} />)

      fireEvent.click(boutonRetourDefaut())

      await waitFor(() => expect(boutonRetourDefaut().disabled).toBe(true))
      libere({ ok: true })
      await waitFor(() => expect(boutonRetourDefaut().disabled).toBe(false))
    })
  })
})
