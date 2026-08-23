// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { FiltreEtats } from './FiltreEtats'

describe('FiltreEtats', () => {
  afterEach(() => {
    cleanup()
    push.mockClear()
  })

  it('propose les cinq etats', () => {
    render(<FiltreEtats etats={['BROUILLON', 'ENVOYE', 'REFUSE']} month={undefined} />)

    for (const nom of ['Brouillon', 'Envoyé', 'Validé', 'Refusé', 'Facturé']) {
      expect(screen.getByRole('checkbox', { name: nom })).toBeTruthy()
    }
  })

  it('coche ce qui est actif, decoche le reste', () => {
    render(<FiltreEtats etats={['BROUILLON', 'ENVOYE', 'REFUSE']} month={undefined} />)

    expect((screen.getByRole('checkbox', { name: 'Envoyé' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Validé' }) as HTMLInputElement).checked).toBe(false)
  })

  // Ce qu'on regarde vit dans l'adresse : c'est ce qui rend le filtrage
  // partageable, rejouable, et resistant au rechargement.
  it('ecrit le choix dans l adresse', async () => {
    render(<FiltreEtats etats={['ENVOYE']} month={undefined} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Facturé' }))

    expect(push).toHaveBeenCalledWith('/cra?etats=ENVOYE%2CFACTURE')
  })

  // Tout decocher n'est pas « revenir au defaut » : c'est un choix, et
  // l'adresse doit pouvoir le dire.
  it('ecrit un parametre vide quand tout est decoche', async () => {
    render(<FiltreEtats etats={['ENVOYE']} month={undefined} />)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Envoyé' }))

    expect(push).toHaveBeenCalledWith('/cra?etats=')
  })
})
