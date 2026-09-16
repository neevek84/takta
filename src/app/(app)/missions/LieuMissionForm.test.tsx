// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { saveLieuMission } = vi.hoisted(() => ({ saveLieuMission: vi.fn() }))
vi.mock('./actions', () => ({ saveLieuMission }))

import { LieuMissionForm } from './LieuMissionForm'

beforeEach(() => {
  saveLieuMission.mockReset().mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('LieuMissionForm', () => {
  it('affiche le lieu enregistré', () => {
    render(<LieuMissionForm missionId="m1" lieuDefaut="SITE" />)
    expect(screen.getByLabelText('Lieu par défaut')).toHaveProperty('value', 'SITE')
  })

  it('transporte la mission et le lieu choisi', async () => {
    render(<LieuMissionForm missionId="m1" lieuDefaut="DISTANCE" />)
    fireEvent.change(screen.getByLabelText('Lieu par défaut'), { target: { value: 'SITE' } })
    fireEvent.submit(document.querySelector('form')!)

    await waitFor(() => expect(saveLieuMission).toHaveBeenCalledTimes(1))
    const formData = saveLieuMission.mock.calls[0]![1] as FormData
    expect([formData.get('missionId'), formData.get('lieuDefaut')]).toEqual(['m1', 'SITE'])
  })

  it('dit ce que le lieu change dans l agenda', () => {
    render(<LieuMissionForm missionId="m1" lieuDefaut="SITE" />)
    expect(screen.getByText(/trajet/)).toBeTruthy()
  })
})
