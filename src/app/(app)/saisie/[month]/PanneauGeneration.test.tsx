// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PanneauGeneration } from './PanneauGeneration'

const props = {
  month: '2026-03',
  missionLabel: 'ACME · ITSM',
  onAnnuler: vi.fn(),
  onChoix: vi.fn(),
}

describe('PanneauGeneration', () => {
  afterEach(() => {
    cleanup()
    props.onChoix.mockClear()
    props.onAnnuler.mockClear()
  })

  it('nomme la mission, le mois et le nombre de jours', () => {
    render(<PanneauGeneration {...props} previsionnel={7} />)

    expect(screen.getByText(/7 jours en prévisionnel/)).toBeTruthy()
    expect(screen.getByText(/ACME · ITSM/)).toBeTruthy()
  })

  it('accorde le singulier', () => {
    render(<PanneauGeneration {...props} previsionnel={1} />)

    expect(screen.getByText(/1 jour en prévisionnel/)).toBeTruthy()
  })

  // Deux chemins explicites, aucun par defaut : c'est toute la demande.
  it('offre les deux issues, et aucune n est prechoisie', () => {
    render(<PanneauGeneration {...props} previsionnel={7} />)

    expect(screen.getByRole('button', { name: /Valider ces jours/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Les supprimer/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Annuler/ })).toBeTruthy()
    expect(props.onChoix).not.toHaveBeenCalled()
  })

  it('remonte le choix de validation', async () => {
    render(<PanneauGeneration {...props} previsionnel={7} />)

    await userEvent.click(screen.getByRole('button', { name: /Valider ces jours/ }))

    expect(props.onChoix).toHaveBeenCalledWith('VALIDER')
  })

  it('remonte le choix de suppression', async () => {
    render(<PanneauGeneration {...props} previsionnel={7} />)

    await userEvent.click(screen.getByRole('button', { name: /Les supprimer/ }))

    expect(props.onChoix).toHaveBeenCalledWith('SUPPRIMER')
  })

  // Une boite de dialogue qui demande quoi faire de zero jour apprend a
  // l'utilisateur a cliquer sans lire.
  it('ne pose aucune question quand il n y a rien a trancher', () => {
    const { container } = render(<PanneauGeneration {...props} previsionnel={0} />)

    expect(container.textContent).not.toContain('prévisionnel')
  })

  it('dit que la suppression est irreversible', () => {
    render(<PanneauGeneration {...props} previsionnel={7} />)

    expect(screen.getByText(/irréversible|ne pourront pas être retrouvés/)).toBeTruthy()
  })
})
