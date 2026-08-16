// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { buildMonthDays } from '@/core/month/build'
import type { LineForGrid } from '@/services/missions'

const { saveCell } = vi.hoisted(() => ({ saveCell: vi.fn() }))
vi.mock('./actions', () => ({ saveCell }))

// `vi.mock` est hissé au-dessus des imports : le server action n'est jamais
// chargé, seul le composant l'est.
import { SaisieClient } from './SaisieClient'

const lines: LineForGrid[] = [
  {
    id: 'l1',
    label: 'Consultant ITSM',
    missionLabel: 'ITSM',
    clientName: 'ACME',
    displayUnit: 'JOUR',
    minutesParJour: 480,
    soldCentiemes: 3000,
    allowedSlotIds: [],
  },
]

function renderClient(): void {
  render(
    <SaisieClient
      month="2026-03"
      days={buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])}
      lines={lines}
      entries={[]}
      engagementTotals={{ l1: [] }}
      capacityMinutes={480}
      minutesParJour={480}
    />,
  )
}

function saisir(valeur: string): HTMLInputElement {
  const input = screen.getByLabelText('Consultant ITSM 2026-03-12') as HTMLInputElement
  fireEvent.change(input, { target: { value: valeur } })
  fireEvent.blur(input)
  return input
}

describe('SaisieClient', () => {
  beforeEach(() => saveCell.mockReset())
  afterEach(cleanup)

  // I1 — en mode AVERTISSEMENT, le dépassement est signalé sans être bloqué.
  it('affiche le dépassement signalé sans effacer la saisie', async () => {
    saveCell.mockResolvedValue({
      ok: true,
      minutes: 240,
      warning: { totalCentiemes: 150, capacityCentiemes: 100 },
    })
    renderClient()
    const input = saisir('0,5')

    // Le message parle de jours, l'unité dans laquelle le contrôle raisonne
    // désormais — et celle qu'emploient déjà l'engagement et la charge.
    const message = await screen.findByText(/Capacité dépassée/)
    expect(message.textContent).toContain('1,5 j saisis pour une capacité de 1 j')
    expect(message.textContent).toContain('conservée')
    expect(input.value).toBe('0,5')
  })

  it("n'affiche aucun message quand la saisie passe sans avertissement", async () => {
    saveCell.mockResolvedValue({ ok: true, minutes: 240 })
    renderClient()
    saisir('0,5')

    await waitFor(() => expect(saveCell).toHaveBeenCalled())
    expect(screen.queryByText(/Capacité dépassée/)).toBeNull()
  })

  it('affiche le refus de capacité et vide la cellule refusée', async () => {
    saveCell.mockResolvedValue({
      ok: false,
      reason: 'CAPACITE',
      totalCentiemes: 114,
      capacityCentiemes: 100,
    })
    renderClient()
    const input = saisir('0,5')

    const message = await screen.findByText(/Capacité dépassée/)
    expect(message.textContent).toContain('1,14 j saisis pour une capacité de 1 j')
    expect(message.textContent).toContain('refusée')
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('affiche le verrouillage du mois et vide la cellule refusée', async () => {
    saveCell.mockResolvedValue({ ok: false, reason: 'VERROUILLE' })
    renderClient()
    const input = saisir('0,5')

    await waitFor(() => expect(screen.getByText(/CRA de ce mois est validé/)).toBeDefined())
    await waitFor(() => expect(input.value).toBe(''))
  })

  it("affiche l'absence d'affectation sur la ligne", async () => {
    saveCell.mockResolvedValue({ ok: false, reason: 'NON_AFFECTE' })
    renderClient()
    saisir('0,5')

    await waitFor(() => expect(screen.getByText(/affecté/)).toBeDefined())
  })

  it('affiche la saisie invalide et vide la cellule', async () => {
    saveCell.mockResolvedValue({ ok: false, reason: 'SAISIE_INVALIDE' })
    renderClient()
    const input = saisir('abc')

    await waitFor(() => expect(screen.getByText(/Saisie invalide/)).toBeDefined())
    await waitFor(() => expect(input.value).toBe(''))
  })
})
