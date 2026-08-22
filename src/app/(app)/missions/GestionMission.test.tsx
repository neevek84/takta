// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { chargerImpactMission, detacherMissionDeDolibarr, detruireMission, rangerMission } =
  vi.hoisted(() => ({
    chargerImpactMission: vi.fn(),
    detacherMissionDeDolibarr: vi.fn(),
    detruireMission: vi.fn(),
    rangerMission: vi.fn(),
  }))
vi.mock('./actions', () => ({
  chargerImpactMission,
  detacherMissionDeDolibarr,
  detruireMission,
  rangerMission,
}))

import { GestionMission } from './GestionMission'

const IMPACT = { prestations: 2, saisies: 41, cras: 3, crasValides: 2, correspondances: 47 }

beforeEach(() => {
  chargerImpactMission.mockReset().mockResolvedValue(IMPACT)
  detacherMissionDeDolibarr.mockReset().mockResolvedValue({ ok: true, message: 'Détachée.' })
  detruireMission.mockReset().mockResolvedValue({ ok: true, message: 'Supprimée.' })
  rangerMission.mockReset().mockResolvedValue({ ok: true, message: 'Archivée.' })
})

afterEach(cleanup)

async function ouvrir(dansDolibarr = true) {
  render(<GestionMission missionId="m1" label="VALID connecteur" dansDolibarr={dansDolibarr} />)
  fireEvent.click(screen.getByRole('button', { name: /Détacher, archiver ou supprimer/ }))
  await screen.findByText(/Suppression définitive/)
}

describe('GestionMission', () => {
  it('ne compte rien tant que le volet est fermé', () => {
    render(<GestionMission missionId="m1" label="VALID connecteur" dansDolibarr />)
    expect(chargerImpactMission).not.toHaveBeenCalled()
  })

  // Une suppression ne se rattrape pas : ce qu'elle emporte se montre avant.
  it('affiche ce que la suppression détruirait, avant de la proposer', async () => {
    await ouvrir()
    expect(screen.getByText('41')).toBeTruthy()
    expect(screen.getByText('2 validé(s)')).toBeTruthy()
    expect(screen.getByText(/Rien ne sera supprimé dans Dolibarr/)).toBeTruthy()
  })

  // Un CRA validé a été envoyé au client, parfois signé. Le compter sans le
  // dire laisserait croire à du brouillon.
  it('avertit spécialement quand des CRA validés seraient détruits', async () => {
    await ouvrir()
    expect(screen.getByText(/seule trace locale de ce qui a été facturé/)).toBeTruthy()
  })

  it('ne met pas en garde quand aucun CRA validé n est en jeu', async () => {
    chargerImpactMission.mockResolvedValue({ ...IMPACT, crasValides: 0 })
    await ouvrir()
    expect(screen.queryByText(/seule trace locale/)).toBeNull()
  })

  // Un clic ne doit pas suffire à détruire des CRA signés.
  it('refuse de supprimer tant que le libellé n est pas recopié', async () => {
    await ouvrir()
    const bouton = screen.getByRole('button', { name: /Supprimer définitivement/ })
    expect(bouton).toHaveProperty('disabled', true)

    fireEvent.change(screen.getByLabelText(/Recopiez/), { target: { value: 'à peu près' } })
    expect(screen.getByRole('button', { name: /Supprimer définitivement/ })).toHaveProperty(
      'disabled',
      true,
    )

    fireEvent.change(screen.getByLabelText(/Recopiez/), { target: { value: 'VALID connecteur' } })
    expect(screen.getByRole('button', { name: /Supprimer définitivement/ })).toHaveProperty(
      'disabled',
      false,
    )
  })

  it('transmet la confirmation exacte au service', async () => {
    await ouvrir()
    fireEvent.change(screen.getByLabelText(/Recopiez/), { target: { value: 'VALID connecteur' } })
    fireEvent.click(screen.getByRole('button', { name: /Supprimer définitivement/ }))

    await waitFor(() => expect(detruireMission).toHaveBeenCalledWith('m1', 'VALID connecteur'))
  })

  // Le geste qui convient quand le projet distant a disparu.
  it('propose de détacher, et seulement si la mission est reliée à Dolibarr', async () => {
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Détacher de Dolibarr' }))
    await waitFor(() => expect(detacherMissionDeDolibarr).toHaveBeenCalledWith('m1'))

    cleanup()
    await ouvrir(false)
    expect(screen.queryByRole('button', { name: 'Détacher de Dolibarr' })).toBeNull()
  })

  it('archive sans rien détruire', async () => {
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Archiver' }))

    await waitFor(() => expect(rangerMission).toHaveBeenCalledWith('m1', true))
    expect(await screen.findByText('Archivée.')).toBeTruthy()
  })

  it('affiche le refus du service au lieu de laisser croire à une suppression', async () => {
    detruireMission.mockResolvedValue({ ok: false, erreur: 'Cette mission n’existe plus.' })
    await ouvrir()
    fireEvent.change(screen.getByLabelText(/Recopiez/), { target: { value: 'VALID connecteur' } })
    fireEvent.click(screen.getByRole('button', { name: /Supprimer définitivement/ }))

    expect(await screen.findByText('Cette mission n’existe plus.')).toBeTruthy()
  })
})
