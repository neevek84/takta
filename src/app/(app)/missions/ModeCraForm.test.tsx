// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { saveModeCra } = vi.hoisted(() => ({ saveModeCra: vi.fn() }))
vi.mock('./actions', () => ({ saveModeCra }))

import { ModeCraForm } from './ModeCraForm'

beforeEach(() => {
  saveModeCra.mockReset().mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('ModeCraForm', () => {
  it('affiche le réglage enregistré', () => {
    render(<ModeCraForm missionId="m1" modeCra="PRESTATION" />)
    expect(screen.getByLabelText('CRA')).toHaveProperty('value', 'PRESTATION')
  })

  it('transporte la mission et le réglage choisi', async () => {
    render(<ModeCraForm missionId="m1" modeCra="MISSION" />)
    fireEvent.change(screen.getByLabelText('CRA'), { target: { value: 'PRESTATION' } })
    fireEvent.submit(document.querySelector('form')!)

    await waitFor(() => expect(saveModeCra).toHaveBeenCalledTimes(1))
    const formData = saveModeCra.mock.calls[0]![1] as FormData
    expect([formData.get('missionId'), formData.get('modeCra')]).toEqual(['m1', 'PRESTATION'])
  })

  it('garde affiché le réglage qu’on vient d’enregistrer', async () => {
    render(<ModeCraForm missionId="m1" modeCra="MISSION" />)
    fireEvent.change(screen.getByLabelText('CRA'), { target: { value: 'PRESTATION' } })
    fireEvent.submit(document.querySelector('form')!)

    await screen.findByText('Facturation enregistrée.')
    expect(screen.getByLabelText('CRA')).toHaveProperty('value', 'PRESTATION')
  })

  it('dit ce que deviennent les CRA déjà générés', () => {
    render(<ModeCraForm missionId="m1" modeCra="MISSION" />)
    expect(screen.getByText(/déjà envoyés ou validés restent tels quels/)).toBeTruthy()
  })

  it('dit pourquoi le réglage est refusé', async () => {
    saveModeCra.mockResolvedValue({ ok: false, erreur: 'Cette mission ne vous est pas affectée.' })
    render(<ModeCraForm missionId="m1" modeCra="MISSION" />)
    fireEvent.submit(document.querySelector('form')!)
    expect(await screen.findByText('Cette mission ne vous est pas affectée.')).toBeTruthy()
  })
})
