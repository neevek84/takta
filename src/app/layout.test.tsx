import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CSSProperties, ReactElement } from 'react'
import { DEFAULT_THEME, THEME_NEUTRE } from '@/core/theme/tokens'
import { themeToCssVars } from '@/core/theme/css-vars'

const { getTheme } = vi.hoisted(() => ({ getTheme: vi.fn() }))
vi.mock('@/services/theme', () => ({ getTheme }))

// La feuille de style et les polices ne sont pas le sujet : seul compte ce
// que le layout fait du thème.
vi.mock('./globals.css', () => ({}))
vi.mock('next/font/local', () => ({
  default: () => ({ variable: '--police', className: 'police' }),
}))

import RootLayout from './layout'

beforeEach(() => {
  getTheme.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

/** Le style posé sur `<html>`, d'où sortent les variables de thème. */
async function styleRacine(): Promise<CSSProperties> {
  const html = (await RootLayout({ children: null })) as ReactElement<{ style: CSSProperties }>
  return html.props.style
}

describe('RootLayout', () => {
  it('pose les variables du thème enregistré', async () => {
    getTheme.mockResolvedValue(THEME_NEUTRE)
    expect(await styleRacine()).toEqual(themeToCssVars(THEME_NEUTRE))
  })

  it('rend quand même la page quand la lecture du thème jette', async () => {
    // Base injoignable, colonne absente, table absente : le thème est un
    // habillage, il ne doit pas emporter toutes les pages — `/login`
    // compris, sans quoi l'exploitant n'a plus d'écran pour diagnostiquer.
    getTheme.mockRejectedValue(new Error('base injoignable'))

    await expect(styleRacine()).resolves.toEqual(themeToCssVars(DEFAULT_THEME))
  })

  it('journalise la panne au lieu de l’avaler en silence', async () => {
    const journal = vi.spyOn(console, 'error').mockImplementation(() => {})
    getTheme.mockRejectedValue(new Error('base injoignable'))

    await styleRacine()

    expect(journal).toHaveBeenCalled()
  })
})
