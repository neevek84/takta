// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { creerPremierAdmin } = vi.hoisted(() => ({ creerPremierAdmin: vi.fn() }))
vi.mock('./actions', () => ({ creerPremierAdmin }))

import { PremierAdminForm } from './PremierAdminForm'

beforeEach(() => {
  // Le succès ne revient pas par l'état : il redirige. `null` est donc ce que
  // rend l'action quand tout va bien, du point de vue de ce composant.
  creerPremierAdmin.mockReset().mockResolvedValue(null)
})

afterEach(cleanup)

describe("l'écran de premier démarrage", () => {
  it('dit ce qui se passe et ce que le compte pourra faire', () => {
    render(<PremierAdminForm />)
    expect(screen.getByText(/n’a encore aucun compte/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Créer le premier administrateur/ })).toBeTruthy()
  })

  // Cet écran répond dès que l'installation est joignable, et c'est sa seule
  // porte. Le navigateur doit refuser un mot de passe court avant même que la
  // requête parte — le service le refuse aussi, mais dire pourquoi tout de
  // suite vaut mieux que refuser après coup.
  it('exige douze caractères, dès le navigateur', () => {
    render(<PremierAdminForm />)
    const champ = screen.getByLabelText('Mot de passe')
    expect(champ.getAttribute('minlength')).toBe('12')
    expect(champ.getAttribute('type')).toBe('password')
  })

  it('transmet les trois champs au service', async () => {
    render(<PremierAdminForm />)
    fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Keveen' } })
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'moi@exemple.test' },
    })
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'un-mot-de-passe-solide' },
    })
    fireEvent.submit(screen.getByRole('button', { name: /Créer le premier/ }).closest('form')!)

    await waitFor(() => expect(creerPremierAdmin).toHaveBeenCalled())
    const donnees = creerPremierAdmin.mock.calls[0]![1] as FormData
    expect(donnees.get('name')).toBe('Keveen')
    expect(donnees.get('email')).toBe('moi@exemple.test')
    expect(donnees.get('motDePasse')).toBe('un-mot-de-passe-solide')
  })

  it('affiche le refus du service au lieu de laisser croire au succès', async () => {
    creerPremierAdmin.mockResolvedValue({
      ok: false,
      message: 'Cette instance a déjà un compte : la création du premier administrateur est close.',
    })
    render(<PremierAdminForm />)
    fireEvent.submit(screen.getByRole('button', { name: /Créer le premier/ }).closest('form')!)

    expect(await screen.findByText(/déjà un compte/)).toBeTruthy()
  })
})
