// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

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

  it('mène à l écran de connexion et de rattachement Dolibarr', async () => {
    // C'est l'écran par lequel la clé d'API se saisit : sans lien, le
    // connecteur ne peut pas être configuré du tout.
    render(await AppLayout({ children: null }))

    const lien = screen.getByRole('link', { name: 'Dolibarr' })
    expect(lien.getAttribute('href')).toBe('/admin/dolibarr')
  })
})
