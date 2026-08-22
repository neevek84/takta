// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { chargerTachesReprenables, appliquerRepriseTaches } = vi.hoisted(() => ({
  chargerTachesReprenables: vi.fn(),
  appliquerRepriseTaches: vi.fn(),
}))
vi.mock('./actions', () => ({ chargerTachesReprenables, appliquerRepriseTaches }))

import { RepriseTaches } from './RepriseTaches'

const TACHE = {
  taskId: 34,
  ref: 'TK2608-0001',
  label: 'Cadrage',
  joursVendusCentiemes: 500,
  sansCharge: false,
  dejaLiee: null,
}

beforeEach(() => {
  chargerTachesReprenables.mockReset().mockResolvedValue({
    projectId: 178,
    taches: [TACHE],
    prestations: [{ lineId: 'l1', label: 'Pilotage', dejaLiee: false }],
  })
  appliquerRepriseTaches.mockReset().mockResolvedValue({
    ok: true,
    resultat: { creees: 1, appariees: 0, ignorees: 0, sansCharge: 0, ecartees: [] },
  })
})

afterEach(cleanup)

/**
 * Ouvre le volet et attend que la transition soit **retombée** — pas seulement
 * que le texte apparaisse. Voir le commentaire jumeau dans `RepriseTemps.test`.
 */
async function ouvrir() {
  render(<RepriseTaches missionId="m1" />)
  fireEvent.click(screen.getByRole('button', { name: /Reprendre les tâches/ }))
  await screen.findByRole('button', { name: 'Appliquer' })
}

describe('RepriseTaches', () => {
  // Lire les tâches interroge Dolibarr. Le faire au rendu ferait dépendre la
  // page des missions d'un aller-retour réseau par mission.
  it("n'interroge Dolibarr qu'à l'ouverture du volet", () => {
    render(<RepriseTaches missionId="m1" />)
    expect(chargerTachesReprenables).not.toHaveBeenCalled()
  })

  it('montre la tâche et les jours vendus déduits de sa charge', async () => {
    await ouvrir()
    expect(screen.getByText('TK2608-0001')).toBeTruthy()
    expect(screen.getByText('5 j')).toBeTruthy()
  })

  // Une reprise ne se subit pas : ouvrir le volet ne doit rien créer.
  it('ne décide rien par défaut', async () => {
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }))

    await waitFor(() => expect(appliquerRepriseTaches).toHaveBeenCalled())
    expect(appliquerRepriseTaches.mock.calls[0]![1]).toEqual([{ taskId: 34, action: 'IGNORER' }])
  })

  it('transmet la création demandée', async () => {
    await ouvrir()
    fireEvent.change(screen.getByLabelText('Reprise'), { target: { value: 'CREER' } })
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }))

    await waitFor(() => expect(appliquerRepriseTaches).toHaveBeenCalled())
    expect(appliquerRepriseTaches.mock.calls[0]![1]).toEqual([{ taskId: 34, action: 'CREER' }])
  })

  it('transmet la prestation choisie pour un appariement', async () => {
    await ouvrir()
    fireEvent.change(screen.getByLabelText('Reprise'), { target: { value: 'l1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }))

    await waitFor(() => expect(appliquerRepriseTaches).toHaveBeenCalled())
    expect(appliquerRepriseTaches.mock.calls[0]![1]).toEqual([
      { taskId: 34, action: 'APPARIER', lineId: 'l1' },
    ])
  })

  // Une charge absente n'est pas une charge nulle : sans ce signalement, le
  // porteur croirait la prestation engagée à zéro jour.
  it("avertit quand une tâche ne porte aucune charge", async () => {
    chargerTachesReprenables.mockResolvedValue({
      projectId: 178,
      taches: [{ ...TACHE, sansCharge: true, joursVendusCentiemes: 0 }],
      prestations: [],
    })
    await ouvrir()

    expect(screen.getByText(/aucune charge prévue/)).toBeTruthy()
    expect(screen.getByText('charge non renseignée')).toBeTruthy()
  })

  // Une tâche déjà reprise ne doit pas être proposée une seconde fois : la
  // deuxième prestation viserait la même tâche, et les temps des deux
  // partiraient au même endroit.
  it('ne propose pas les tâches déjà reprises', async () => {
    chargerTachesReprenables.mockResolvedValue({
      projectId: 178,
      taches: [{ ...TACHE, dejaLiee: { lineId: 'l9', label: 'Cadrage' } }],
      prestations: [{ lineId: 'l9', label: 'Cadrage', dejaLiee: true }],
    })
    render(<RepriseTaches missionId="m1" />)
    fireEvent.click(screen.getByRole('button', { name: /Reprendre les tâches/ }))

    await screen.findByText(/déjà reprises/)
    expect(screen.queryByLabelText('Reprise')).toBeNull()
  })

  // Une prestation qui vise déjà une tâche ne peut pas être appariée ailleurs :
  // le service refuserait, l'écran ne doit pas le proposer.
  it("n'offre pas d'apparier une prestation déjà rattachée", async () => {
    chargerTachesReprenables.mockResolvedValue({
      projectId: 178,
      taches: [TACHE],
      prestations: [
        { lineId: 'l1', label: 'Pilotage', dejaLiee: true },
        { lineId: 'l2', label: 'Recette', dejaLiee: false },
      ],
    })
    await ouvrir()

    expect(screen.queryByText(/Apparier à « Pilotage »/)).toBeNull()
    expect(screen.getByText(/Apparier à « Recette »/)).toBeTruthy()
  })

  // Un projet mixte — une tâche déjà reprise, une autre non — est le cas
  // ordinaire d'une reprise en deux temps. La tâche déjà reprise ne doit pas
  // repartir dans les décisions : le service l'écarterait, et le compte rendu
  // se remplirait de refus que le porteur n'a pas demandés.
  it("n'envoie aucune décision pour les tâches déjà reprises", async () => {
    chargerTachesReprenables.mockResolvedValue({
      projectId: 178,
      taches: [
        { ...TACHE, taskId: 34, label: 'Cadrage', dejaLiee: { lineId: 'l9', label: 'Cadrage' } },
        { ...TACHE, taskId: 35, label: 'Recette', dejaLiee: null },
      ],
      prestations: [{ lineId: 'l9', label: 'Cadrage', dejaLiee: true }],
    })
    render(<RepriseTaches missionId="m1" />)
    fireEvent.click(screen.getByRole('button', { name: /Reprendre les tâches/ }))
    await screen.findByText('Recette')

    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }))

    await waitFor(() => expect(appliquerRepriseTaches).toHaveBeenCalled())
    expect(appliquerRepriseTaches.mock.calls[0]![1]).toEqual([{ taskId: 35, action: 'IGNORER' }])
  })

  it('rend compte de ce qui a été écarté', async () => {
    appliquerRepriseTaches.mockResolvedValue({
      ok: true,
      resultat: {
        creees: 0,
        appariees: 0,
        ignorees: 0,
        sansCharge: 0,
        ecartees: ['La tâche « Cadrage » est déjà reprise par la prestation « Pilotage ».'],
      },
    })
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }))

    expect(await screen.findByText(/déjà reprise par la prestation/)).toBeTruthy()
  })

  it("affiche le refus de Dolibarr au lieu de laisser croire à une reprise faite", async () => {
    appliquerRepriseTaches.mockResolvedValue({ ok: false, erreur: 'Dolibarr est injoignable.' })
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: 'Appliquer' }))

    expect(await screen.findByText('Dolibarr est injoignable.')).toBeTruthy()
  })
})
