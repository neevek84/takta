// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import {
  THEME_KREATIVPM,
  THEME_SOMBRE,
  type ThemeConfig,
} from '@/core/theme/tokens'

const MARQUE: ThemeConfig = { mode: 'clair', clair: THEME_KREATIVPM, sombre: THEME_SOMBRE }

const { requireUser, getThemeConfig } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getThemeConfig: vi.fn(),
}))

vi.mock('@/auth', () => ({
  requireUser,
  // Les gardes de rôle s'appuient sur la même session, et **appliquent la vraie
  // règle** : `peutAdministrer` est importée, pas recopiée. Un double qui
  // laisserait passer un consultant ferait passer au vert une action sans
  // garde — c'est arrivé, et c'est ce test-ci qui l'a dit.
  exigerAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer, MOTIF_REFUS_ADMIN } = await import('@/core/auth/roles')
    if (!peutAdministrer(u.role)) throw new Error(MOTIF_REFUS_ADMIN)
    return u
  },
  accesAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer } = await import('@/core/auth/roles')
    return { autorise: peutAdministrer(u.role), user: u }
  },
}))
// `validateThemeConfig` reste le vrai : c'est le service qui décide ce qui est
// illisible, la page ne fait que rapporter son verdict.
vi.mock('@/services/theme', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/services/theme')>()
  return { ...reel, getThemeConfig }
})
vi.mock('./ThemeForm', () => ({ ThemeForm: () => <div data-testid="formulaire" /> }))

import AdminThemePage from './page'

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  getThemeConfig.mockReset()
})
afterEach(cleanup)

describe('page Administration · Thème', () => {
  it('n’avertit de rien quand la palette en base est saine', async () => {
    getThemeConfig.mockResolvedValue(MARQUE)

    render(await AdminThemePage())

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('formulaire')).toBeDefined()
  })

  it('signale une palette déjà en base qui ne passerait plus l’enregistrement', async () => {
    // Écriture manuelle, reprise de données, ou palette validée sous une
    // version antérieure de la table des couples : `getThemeConfig` la rend telle
    // quelle — c'est voulu, l'habillage ne fait pas tomber la page — mais
    // l'exploitant ne doit pas la découvrir en tentant un enregistrement.
    getThemeConfig.mockResolvedValue({ ...MARQUE, clair: { ...THEME_KREATIVPM, ink: '#d4943f' } })

    render(await AdminThemePage())

    const bandeau = await screen.findByRole('alert')
    expect(bandeau.textContent).toContain('encre')
    expect(bandeau.textContent).toContain('fond de page')
    expect(bandeau.textContent).toContain('2,38')
    // Et il dit dans laquelle des deux palettes corriger.
    expect(bandeau.textContent).toContain('Thème clair')
    // Le formulaire reste utilisable : c'est un avertissement, pas un refus.
    expect(screen.getByTestId('formulaire')).toBeDefined()
  })

  it('signale la palette catégorielle chaude reprise du lot 1e', async () => {
    // Le cas réel du porteur : sa palette de marque, enregistrée sous le lot
    // 1e, n'avait jamais été confrontée aux fonds qui portent ses teintes.
    // Elle reste appliquée — l'habillage ne fait pas tomber la page — mais
    // l'écran doit le dire avant qu'un enregistrement échoue sans prévenir.
    getThemeConfig.mockResolvedValue({
      ...MARQUE,
      clair: {
        ...THEME_KREATIVPM,
        catF: '#f9e1e5',
        catFInk: '#411018',
        catFEdge: '#dfc3c8',
      },
    })

    render(await AdminThemePage())

    const bandeau = await screen.findByRole('alert')
    expect(bandeau.textContent).toContain('catégorie 6')
    expect(bandeau.textContent).toContain('fond des jours non ouvrés')
  })

  // Cet écran était le dernier en `max-w-3xl` : son bord gauche ne tombait au
  // même endroit que celui d'aucun autre.
  it('se rend dans le gabarit commun, comme tous les autres écrans', async () => {
    getThemeConfig.mockResolvedValue(MARQUE)

    const { container } = render(await AdminThemePage())

    const principal = container.querySelector('main')!
    expect(principal.className).toContain('max-w-[100rem]')
    expect(principal.className).not.toContain('max-w-3xl')
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('text-2xl')
  })
})

describe('le rôle, et non la seule session', () => {
  // Le contrôle structurel prouve que la garde est **appelée** ; celui-ci
  // prouve qu'elle **refuse**. Sans lui, une garde qui rendrait toujours
  // « autorisé » passerait les deux.
  it('refuse un consultant, et ne lit rien de ce que la page allait lire', async () => {
    requireUser.mockResolvedValue({ id: 'u2', role: 'CONSULTANT' })

    render(await AdminThemePage())

    expect(screen.getByText(/ne vous est pas ouvert/)).toBeTruthy()
    expect(screen.getByText('CONSULTANT')).toBeTruthy()
    // Rien de ce que la page allait lire n'a été lu : le refus vient avant.
    expect(getThemeConfig).not.toHaveBeenCalled()
  })

  it('laisse passer un administrateur', async () => {
    requireUser.mockResolvedValue({ id: 'u1', role: 'ADMIN' })

    render(await AdminThemePage())

    expect(screen.queryByText(/ne vous est pas ouvert/)).toBeNull()
    expect(getThemeConfig).toHaveBeenCalled()
  })
})

