// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { chargerTempsReprenables, appliquerRepriseTemps } = vi.hoisted(() => ({
  chargerTempsReprenables: vi.fn(),
  appliquerRepriseTemps: vi.fn(),
}))
vi.mock('./actions', () => ({ chargerTempsReprenables, appliquerRepriseTemps }))

import { RepriseTemps } from './RepriseTemps'

const AVEC_TEMPS = {
  coupure: '2026-07-31',
  prestations: [
    { lineId: 'l1', label: 'Cadrage', taskId: 34, aReprendre: 12, dejaRepris: 0, apresCoupure: 3 },
  ],
  auteurs: [{ dolibarrUserId: 1, connu: false }],
}

beforeEach(() => {
  chargerTempsReprenables.mockReset().mockResolvedValue(AVEC_TEMPS)
  appliquerRepriseTemps.mockReset().mockResolvedValue({
    ok: true,
    resultat: {
      reprises: 12,
      utilisateursCrees: 1,
      moisVerrouilles: ['2026-06', '2026-07'],
      ecartes: [],
    },
  })
})

afterEach(cleanup)

async function ouvrir() {
  render(<RepriseTemps missionId="m1" />)
  fireEvent.click(screen.getByRole('button', { name: /Reprendre les temps déjà saisis/ }))
  await screen.findByText(/Reprise jusqu’au/)
}

describe('RepriseTemps', () => {
  it("n'interroge Dolibarr qu'à l'ouverture", () => {
    render(<RepriseTemps missionId="m1" />)
    expect(chargerTempsReprenables).not.toHaveBeenCalled()
  })

  it('annonce la coupure et ce qu elle écarte', async () => {
    await ouvrir()
    expect(screen.getByText('2026-07-31')).toBeTruthy()
    expect(screen.getByText(/après la coupure/)).toBeTruthy()
  })

  // Le geste que l'application ne fera jamais à la place du porteur : sans lui,
  // le mois en cours existe des deux côtés et sera facturé deux fois.
  it('rappelle de supprimer soi-même les temps du mois en cours dans Dolibarr', async () => {
    await ouvrir()
    expect(screen.getByText(/À faire vous-même dans Dolibarr/)).toBeTruthy()
    expect(screen.getByText(/ne les supprimera jamais elle-même/)).toBeTruthy()
  })

  // Un temps se pose sur une prestation. Sans prestation reliée, proposer un
  // bouton qui ne fera rien serait mentir.
  it('renvoie vers la reprise des tâches quand aucune prestation ne vise une tâche', async () => {
    chargerTempsReprenables.mockResolvedValue({ coupure: '2026-07-31', prestations: [], auteurs: [] })
    render(<RepriseTemps missionId="m1" />)
    fireEvent.click(screen.getByRole('button', { name: /Reprendre les temps déjà saisis/ }))

    await screen.findByText(/Reprenez d’abord les tâches/)
    expect(screen.queryByRole('button', { name: /^Reprendre \d+ temps$/ })).toBeNull()
  })

  it('ne propose pas de reprendre quand il n y a rien à reprendre', async () => {
    chargerTempsReprenables.mockResolvedValue({
      ...AVEC_TEMPS,
      prestations: [{ ...AVEC_TEMPS.prestations[0]!, aReprendre: 0, dejaRepris: 12 }],
    })
    await ouvrir()

    expect(screen.getByRole('button', { name: /Reprendre 0 temps/ })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('dit quels mois la reprise a verrouillés, et pourquoi', async () => {
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: /Reprendre 12 temps/ }))

    await waitFor(() => expect(appliquerRepriseTemps).toHaveBeenCalledWith('m1'))
    expect(await screen.findByText(/2026-06, 2026-07/)).toBeTruthy()
    expect(screen.getByText(/ne repartiront jamais vers Dolibarr/)).toBeTruthy()
  })

  it('rend compte de ce qui a été écarté', async () => {
    appliquerRepriseTemps.mockResolvedValue({
      ok: true,
      resultat: {
        reprises: 0,
        utilisateursCrees: 0,
        moisVerrouilles: [],
        ecartes: ["L'utilisateur Dolibarr n° 9999 n'existe plus"],
      },
    })
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: /Reprendre 12 temps/ }))

    expect(await screen.findByText(/n° 9999/)).toBeTruthy()
  })

  it('affiche le refus au lieu de laisser croire à une reprise faite', async () => {
    appliquerRepriseTemps.mockResolvedValue({ ok: false, erreur: 'Dolibarr est injoignable.' })
    await ouvrir()
    fireEvent.click(screen.getByRole('button', { name: /Reprendre 12 temps/ }))

    expect(await screen.findByText('Dolibarr est injoignable.')).toBeTruthy()
  })
})
