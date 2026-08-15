// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { THEME_KREATIVPM } from '@/core/theme/tokens'

const { requireUser, getTheme } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getTheme: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
// `validateTheme` reste le vrai : c'est le service qui décide ce qui est
// illisible, la page ne fait que rapporter son verdict.
vi.mock('@/services/theme', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/services/theme')>()
  return { ...reel, getTheme }
})
vi.mock('./ThemeForm', () => ({ ThemeForm: () => <div data-testid="formulaire" /> }))

import AdminThemePage from './page'

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  getTheme.mockReset()
})
afterEach(cleanup)

describe('page Administration · Thème', () => {
  it('n’avertit de rien quand la palette en base est saine', async () => {
    getTheme.mockResolvedValue(THEME_KREATIVPM)

    render(await AdminThemePage())

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('formulaire')).toBeDefined()
  })

  it('signale une palette déjà en base qui ne passerait plus l’enregistrement', async () => {
    // Écriture manuelle, reprise de données, ou palette validée sous une
    // version antérieure de la table des couples : `getTheme` la rend telle
    // quelle — c'est voulu, l'habillage ne fait pas tomber la page — mais
    // l'exploitant ne doit pas la découvrir en tentant un enregistrement.
    getTheme.mockResolvedValue({ ...THEME_KREATIVPM, ink: '#d4943f' })

    render(await AdminThemePage())

    const bandeau = await screen.findByRole('alert')
    expect(bandeau.textContent).toContain('encre')
    expect(bandeau.textContent).toContain('fond de page')
    expect(bandeau.textContent).toContain('2,38')
    // Le formulaire reste utilisable : c'est un avertissement, pas un refus.
    expect(screen.getByTestId('formulaire')).toBeDefined()
  })
})
