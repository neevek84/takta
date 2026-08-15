// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('./actions', () => ({ login: vi.fn() }))

// `vi.mock` est hissé au-dessus des imports : l'action serveur (et donc
// `@/auth`, Prisma, argon2) n'est jamais chargée, seul le rendu l'est.
import LoginPage from './page'

afterEach(cleanup)

describe('page de connexion', () => {
  it('ne montre aucun bandeau au premier chargement', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByLabelText('Adresse e-mail') as HTMLInputElement).value).toBe('')
  })

  it('après un échec, affiche le message en français et conserve l’e-mail saisi', async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ erreur: '1', email: 'ada@example.com' }),
      }),
    )

    const bandeau = screen.getByRole('alert')
    expect(bandeau.textContent).toContain('Adresse e-mail ou mot de passe incorrect.')
    expect((screen.getByLabelText('Adresse e-mail') as HTMLInputElement).value).toBe(
      'ada@example.com',
    )
  })
})
