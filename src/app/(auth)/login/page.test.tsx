// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('./actions', () => ({ login: vi.fn(), creerPremierAdmin: vi.fn() }))

// La page interroge la base pour savoir si l'instance est neuve. Le double le
// dit sans base : le rendu est ce qu'on teste ici, pas le comptage.
const { aucunUtilisateur } = vi.hoisted(() => ({ aucunUtilisateur: vi.fn() }))
vi.mock('@/services/auth/comptes', () => ({ aucunUtilisateur }))

// `vi.mock` est hissé au-dessus des imports : l'action serveur (et donc
// `@/auth`, Prisma, argon2) n'est jamais chargée, seul le rendu l'est.
import LoginPage from './page'

beforeEach(() => {
  // Par défaut, une instance déjà peuplée : c'est le cas courant.
  aucunUtilisateur.mockReset().mockResolvedValue(false)
})

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

describe('le premier démarrage', () => {
  // Une instance neuve est murée : sans cet écran, il n'existe aucun moyen de
  // créer le premier compte sans terminal — ce que le porteur d'un NAS n'a pas
  // toujours.
  it("propose de créer l'administrateur quand aucun compte n'existe", async () => {
    aucunUtilisateur.mockResolvedValue(true)

    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('button', { name: /Créer le premier administrateur/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Se connecter' })).toBeNull()
  })

  // La fenêtre ne se rouvre jamais : dès qu'un compte existe, cet écran doit
  // avoir disparu. Le service refuse de toute façon, mais un écran qui propose
  // ce qui sera refusé est un écran qui ment.
  it('disparaît dès qu un compte existe', async () => {
    aucunUtilisateur.mockResolvedValue(false)

    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('button', { name: /Créer le premier administrateur/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeTruthy()
  })
})

