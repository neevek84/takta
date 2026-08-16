// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

/**
 * La page est un composant serveur : elle appelle la session et les services
 * avant de rendre. On leur substitue des doubles — le sujet du test est le
 * câblage, et surtout ce qui se passe quand la lecture d'occupation ne rend
 * rien : la page doit s'afficher et la saisie fonctionner à l'identique.
 */
const { getBusyDays, appliquerCase } = vi.hoisted(() => ({
  getBusyDays: vi.fn(),
  appliquerCase: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser: async () => ({ id: 'u1', role: 'USER' as const }) }))
vi.mock('@/services/availability', () => ({ getBusyDays }))
vi.mock('@/services/settings', () => ({
  getSettings: async () => ({
    minutesParJour: 480,
    capacityMode: 'AVERTISSEMENT',
    capacityCentiemes: 100,
    workingDays: [1, 2, 3, 4, 5],
    slots: [{ id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 }],
    holidays: [],
  }),
}))
vi.mock('@/services/missions', () => ({
  listActiveLines: async () => [
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
  ],
}))
vi.mock('@/services/time-entries', () => ({
  getMonthEntries: async () => [],
  getLineEngagementTotals: async () => ({ l1: [] }),
  getPastForecastWithLockStatus: async () => ({ entries: [], lockedCount: 0 }),
}))
vi.mock('./actions', () => ({
  saveCell: vi.fn(),
  appliquerCase,
  remplirMois: vi.fn(),
  viderMois: vi.fn(),
  validerJoursPasses: vi.fn(),
}))
vi.mock('@/components/MonthNav', () => ({ MonthNav: () => null }))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import SaisiePage from './page'

async function rendre(): Promise<void> {
  render(await SaisiePage({ params: Promise.resolve({ month: '2026-03' }) }))
}

describe('page de saisie — occupation de l agenda', () => {
  beforeEach(() => {
    getBusyDays.mockReset()
    appliquerCase.mockReset()
    window.localStorage.clear()
  })
  afterEach(cleanup)

  it('lit l occupation du mois affiché, pour l utilisateur connecté', async () => {
    getBusyDays.mockResolvedValue([])
    await rendre()
    expect(getBusyDays).toHaveBeenCalledWith('u1', '2026-03')
  })

  it('fait descendre le marquage jusqu à la surface de saisie', async () => {
    getBusyDays.mockResolvedValue(['2026-03-12'])
    await rendre()

    expect(screen.getByTestId('case-2026-03-12').getAttribute('data-busy')).toBe('true')
    expect(screen.getByTestId('case-2026-03-13').getAttribute('data-busy')).toBeNull()
  })

  // La promesse du lot : une panne de Google ne bloque jamais la saisie.
  it('affiche la grille sans marques et laisse saisir quand l agenda est injoignable', async () => {
    // Ce que `getBusyDays` rend en cas de panne : une liste vide, jamais une
    // exception.
    getBusyDays.mockResolvedValue([])
    appliquerCase.mockResolvedValue({ ok: true, state: { kind: 'JOURNEE' } })
    await rendre()

    expect(screen.getByTestId('grille-calendrier')).toBeDefined()
    expect(screen.getByTestId('case-2026-03-12').getAttribute('data-busy')).toBeNull()

    fireEvent.click(screen.getByTestId('case-2026-03-12'))

    await waitFor(() =>
      expect(appliquerCase).toHaveBeenCalledWith({
        lineId: 'l1',
        date: '2026-03-12',
        state: { kind: 'JOURNEE' },
        month: '2026-03',
      }),
    )
    expect(screen.getByTestId('valeur-2026-03-12').textContent).toBe('1')
  })
})
