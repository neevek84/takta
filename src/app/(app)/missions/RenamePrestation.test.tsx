// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { modifierLigne } = vi.hoisted(() => ({ modifierLigne: vi.fn() }))
vi.mock('./actions', () => ({ modifierLigne }))

import { RenamePrestation } from './RenamePrestation'

beforeEach(() => {
  modifierLigne.mockReset().mockResolvedValue({ ok: true })
})

afterEach(cleanup)

/**
 * Renommer une prestation ne touche jamais sa tâche Dolibarr : le lien vit
 * dans une table à part (`ExternalLink`), que `modifierLigne` ne lit ni
 * n'écrit. Ces tests portent sur l'écran, pas sur ce découplage déjà garanti
 * côté service (`missions.test.ts`) — ils vérifient que renommer reste un
 * geste d'un clic, distinct des chiffres verrouillables.
 */
describe('RenamePrestation', () => {
  it('affiche le libellé actuel, sans formulaire tant qu on ne clique pas', () => {
    render(<RenamePrestation lineId="l1" label="Développement backend" />)

    expect(screen.getByText('Développement backend')).toBeTruthy()
    expect(document.querySelector('form')).toBeNull()
  })

  it('ouvre un champ pré-rempli au clic', () => {
    render(<RenamePrestation lineId="l1" label="Développement backend" />)
    fireEvent.click(screen.getByRole('button', { name: /Renommer/ }))

    expect(screen.getByLabelText('Nouveau libellé de la prestation')).toHaveProperty(
      'value',
      'Développement backend',
    )
  })

  it('annule sans rien enregistrer', () => {
    render(<RenamePrestation lineId="l1" label="Développement backend" />)
    fireEvent.click(screen.getByRole('button', { name: /Renommer/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))

    expect(document.querySelector('form')).toBeNull()
    expect(modifierLigne).not.toHaveBeenCalled()
  })

  it('n envoie que l identifiant et le nouveau libellé, jamais de chiffres', () => {
    render(<RenamePrestation lineId="l-42" label="Développement backend" />)
    fireEvent.click(screen.getByRole('button', { name: /Renommer/ }))

    fireEvent.change(screen.getByLabelText('Nouveau libellé de la prestation'), {
      target: { value: 'Développement API' },
    })
    fireEvent.submit(document.querySelector('form')!)

    expect(modifierLigne).toHaveBeenCalledOnce()
    const [, formData] = modifierLigne.mock.calls[0] as [unknown, FormData]
    expect(formData.get('lineId')).toBe('l-42')
    expect(formData.get('label')).toBe('Développement API')
    expect(formData.get('soldCentiemes')).toBeNull()
    expect(formData.get('tjmEuros')).toBeNull()
  })

  it('se referme quand le service confirme l enregistrement', async () => {
    render(<RenamePrestation lineId="l1" label="Développement backend" />)
    fireEvent.click(screen.getByRole('button', { name: /Renommer/ }))
    fireEvent.submit(document.querySelector('form')!)

    await waitFor(() => expect(document.querySelector('form')).toBeNull())
    expect(screen.getByText('Développement backend')).toBeTruthy()
  })

  it('reste ouvert et affiche le refus du service', async () => {
    modifierLigne.mockResolvedValue({ ok: false, message: 'Cette prestation ne vous est pas affectée.' })
    render(<RenamePrestation lineId="l1" label="Développement backend" />)
    fireEvent.click(screen.getByRole('button', { name: /Renommer/ }))
    fireEvent.submit(document.querySelector('form')!)

    await waitFor(() => {
      expect(screen.getByText('Cette prestation ne vous est pas affectée.')).toBeTruthy()
    })
    expect(document.querySelector('form')).not.toBeNull()
  })
})
