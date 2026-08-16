// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const { requireUser, signOut } = vi.hoisted(() => ({ requireUser: vi.fn(), signOut: vi.fn() }))
vi.mock('@/auth', () => ({ requireUser, signOut }))

import AppLayout from './layout'

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  signOut.mockReset()
})
afterEach(cleanup)

describe('navigation de l application', () => {
  it('mène à l écran de supervision de la synchronisation', async () => {
    // Sans ce lien, l'écran existe et personne ne peut l'atteindre : les
    // divergences et les échecs resteraient invisibles jusqu'à ce qu'on
    // connaisse l'URL par cœur.
    render(await AppLayout({ children: null }))

    const lien = screen.getByRole('link', { name: 'Synchro' })
    expect(lien.getAttribute('href')).toBe('/admin/sync')
  })

  it('mène à l écran de supervision des travaux et du journal', async () => {
    // Les avertissements vivent dans l'outil, pas seulement dans un courriel
    // qu'on n'a pas lu : encore faut-il pouvoir ouvrir l'écran qui les porte.
    render(await AppLayout({ children: null }))

    const lien = screen.getByRole('link', { name: 'Supervision' })
    expect(lien.getAttribute('href')).toBe('/admin/supervision')
  })

  it('mène à l écran des abonnements sortants', async () => {
    render(await AppLayout({ children: null }))

    const lien = screen.getByRole('link', { name: 'Abonnements' })
    expect(lien.getAttribute('href')).toBe('/admin/webhooks')
  })

  it('N ABANDONNE AUCUN ÉCRAN D ADMINISTRATION derrière une URL à connaître', async () => {
    // Ce contrôle ne dépend d'aucune liste écrite à la main : il lit les
    // dossiers. Ajouter un écran sans son lien le fait tomber, et retirer le
    // lien d'un écran existant aussi — c'est exactement ce qui manquait quand
    // un plan a proposé de remplacer la liste des liens au lieu de l'étendre.
    render(await AppLayout({ children: null }))

    const racine = path.join(__dirname, 'admin')
    const ecrans = readdirSync(racine, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(path.join(racine, e.name, 'page.tsx')))
      .map((e) => `/admin/${e.name}`)

    expect(ecrans.length).toBeGreaterThan(5)

    const liens = screen
      .getAllByRole('link')
      .map((lien) => lien.getAttribute('href'))
    for (const ecran of ecrans) {
      expect(liens, `aucun lien ne mène à ${ecran}`).toContain(ecran)
    }
  })

  it('mène à l écran de connexion et de rattachement Dolibarr', async () => {
    // C'est l'écran par lequel la clé d'API se saisit : sans lien, le
    // connecteur ne peut pas être configuré du tout.
    render(await AppLayout({ children: null }))

    const lien = screen.getByRole('link', { name: 'Dolibarr' })
    expect(lien.getAttribute('href')).toBe('/admin/dolibarr')
  })
})
