import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactElement } from 'react'
import {
  DEFAULT_THEME_CONFIG,
  THEME_ENCRE_CLAIR,
  THEME_ENCRE_SOMBRE,
  THEME_KREATIVPM,
  THEME_SOMBRE,
  THEME_TOKEN_KEYS,
  type ThemeConfig,
} from '@/core/theme/tokens'
import { cssVarName } from '@/core/theme/css-vars'

const { getThemeConfig } = vi.hoisted(() => ({ getThemeConfig: vi.fn() }))
vi.mock('@/services/theme', () => ({ getThemeConfig }))

// La feuille de style et les polices ne sont pas le sujet : seul compte ce
// que le layout fait du thème.
vi.mock('./globals.css', () => ({}))
vi.mock('next/font/local', () => ({
  default: () => ({ variable: '--police', className: 'police' }),
}))

import RootLayout, { generateViewport } from './layout'

const MARQUE: ThemeConfig = { mode: 'clair', clair: THEME_KREATIVPM, sombre: THEME_SOMBRE }

beforeEach(() => {
  getThemeConfig.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * La feuille injectée dans `<head>`. C'est là que vivent désormais les
 * variables de thème : un attribut `style` sur `<html>` ne peut pas porter de
 * requête média, donc pas la préférence du système.
 */
async function feuille(): Promise<string> {
  interface Noeud {
    props: { children?: unknown; dangerouslySetInnerHTML?: { __html: string } }
    type?: unknown
  }
  const html = (await RootLayout({ children: null })) as ReactElement<{ children: Noeud[] }>
  const trouve = (noeud: unknown): string | null => {
    if (noeud === null || typeof noeud !== 'object') return null
    const n = noeud as Noeud
    if (n.props?.dangerouslySetInnerHTML) return n.props.dangerouslySetInnerHTML.__html
    const enfants = n.props?.children
    for (const enfant of Array.isArray(enfants) ? enfants : [enfants]) {
      const t = trouve(enfant)
      if (t !== null) return t
    }
    return null
  }
  const css = trouve(html)
  if (css === null) throw new Error('aucune feuille de thème dans le layout')
  return css
}

describe('RootLayout', () => {
  it('pose les variables du thème enregistré', async () => {
    getThemeConfig.mockResolvedValue(MARQUE)
    const css = await feuille()
    for (const key of THEME_TOKEN_KEYS) {
      expect(css, key).toContain(`${cssVarName(key)}:${THEME_KREATIVPM[key]};`)
    }
  })

  it('porte les deux palettes quand le thème suit la préférence du système', async () => {
    getThemeConfig.mockResolvedValue(DEFAULT_THEME_CONFIG)
    const css = await feuille()
    expect(css).toContain('@media (prefers-color-scheme:dark)')
    expect(css).toContain(`--color-page:${THEME_ENCRE_CLAIR.page};`)
    expect(css).toContain(`--color-page:${THEME_ENCRE_SOMBRE.page};`)
  })

  it('n’en porte qu’une sur un choix explicite — la préférence est remplacée', async () => {
    getThemeConfig.mockResolvedValue({ ...DEFAULT_THEME_CONFIG, mode: 'sombre' })
    const css = await feuille()
    expect(css).not.toContain('@media')
    expect(css).toContain(`--color-page:${THEME_ENCRE_SOMBRE.page};`)
    expect(css).not.toContain(THEME_ENCRE_CLAIR.page)
  })

  it('rend quand même la page quand la lecture du thème jette', async () => {
    // Base injoignable, colonne absente, table absente : le thème est un
    // habillage, il ne doit pas emporter toutes les pages — `/login`
    // compris, sans quoi l'exploitant n'a plus d'écran pour diagnostiquer.
    getThemeConfig.mockRejectedValue(new Error('base injoignable'))

    const css = await feuille()
    expect(css).toContain(`--color-page:${THEME_ENCRE_CLAIR.page};`)
    expect(css).toContain('@media (prefers-color-scheme:dark)')
  })

  it('journalise la panne au lieu de l’avaler en silence', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
    getThemeConfig.mockRejectedValue(new Error('base injoignable'))

    await feuille()

    expect(journal).toHaveBeenCalled()
  })
})

describe('generateViewport', () => {
  it('dédouble la couleur de la barre quand le thème suit le système', async () => {
    getThemeConfig.mockResolvedValue(DEFAULT_THEME_CONFIG)
    expect((await generateViewport()).themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: THEME_ENCRE_CLAIR.ink },
      { media: '(prefers-color-scheme: dark)', color: THEME_ENCRE_SOMBRE.ink },
    ])
  })

  it('n’en annonce qu’une sur un choix explicite', async () => {
    // Deux couleurs dont une ne s'appliquera jamais feraient basculer la barre
    // du navigateur sans que la page bouge.
    getThemeConfig.mockResolvedValue({ ...DEFAULT_THEME_CONFIG, mode: 'sombre' })
    expect((await generateViewport()).themeColor).toBe(THEME_ENCRE_SOMBRE.ink)

    getThemeConfig.mockResolvedValue(MARQUE)
    expect((await generateViewport()).themeColor).toBe(THEME_KREATIVPM.ink)
  })

  it('n’interdit pas le zoom', async () => {
    getThemeConfig.mockResolvedValue(DEFAULT_THEME_CONFIG)
    expect((await generateViewport()).maximumScale).toBeUndefined()
  })

  it('retombe sur le défaut quand la lecture jette', async () => {
    getThemeConfig.mockRejectedValue(new Error('base injoignable'))
    expect((await generateViewport()).themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: THEME_ENCRE_CLAIR.ink },
      { media: '(prefers-color-scheme: dark)', color: THEME_ENCRE_SOMBRE.ink },
    ])
  })
})

/**
 * **L'onglet du navigateur n'affichait rien.** Les icônes existaient — le
 * manifeste en déclare deux, iOS a la sienne — mais rien ne désignait celle de
 * l'onglet : les navigateurs de bureau ne lisent pas le manifeste pour ça.
 * Une application autohébergée vit dans un onglet parmi vingt ; ne pas s'y
 * reconnaître est un défaut d'usage, pas de coquetterie.
 */
describe("l'icône de l'onglet", () => {
  it('est déclarée, en SVG et en repli matriciel', async () => {
    const { metadata } = await import('./layout')
    const icones = metadata.icons as { icon?: unknown; apple?: unknown }
    const liste = icones.icon as Array<{ url: string; type?: string }>

    expect(liste.map((i) => i.url)).toEqual(['/icon.svg', '/apple-touch-icon.png'])
    // Le type est **nommé** : sans lui, un navigateur qui ne sait pas lire un
    // SVG d'icône ne saurait pas qu'il doit passer au suivant.
    expect(liste[0]?.type).toBe('image/svg+xml')
  })

  it("garde celle de l'écran d'accueil iOS, qui ne se déduit pas des autres", async () => {
    // iOS ignore les icônes du manifeste : sans cette ligne, une application
    // ajoutée à l'écran d'accueil affiche une capture d'écran de la page.
    const { metadata } = await import('./layout')
    expect((metadata.icons as { apple?: unknown }).apple).toBe('/apple-touch-icon.png')
  })
})
