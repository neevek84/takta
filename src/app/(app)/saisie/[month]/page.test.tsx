// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

/**
 * La page est un composant serveur : elle appelle la session et les services
 * avant de rendre. On leur substitue des doubles — le sujet du test est le
 * câblage, et surtout que la page ne parle plus jamais à Google d'elle-même
 * (voir la tâche G) : la saisie doit s'afficher et fonctionner à l'identique.
 *
 * `agendaEspion` double `@/services/availability` **en entier** — si la page
 * importe encore quoi que ce soit de ce module, un appel s'y voit, quelle que
 * soit la fonction appelée.
 */
const { agendaEspion, aUnConnecteurAgenda, appliquerCase } = vi.hoisted(() => ({
  agendaEspion: vi.fn(),
  aUnConnecteurAgenda: vi.fn(),
  appliquerCase: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser: async () => ({ id: 'u1', role: 'USER' as const }) }))
vi.mock('@/services/availability', () => ({ getBusyRange: agendaEspion }))
// La lecture qui remplace l'ancien appel automatique : locale, sans réseau —
// voir `src/services/credentials.ts`.
vi.mock('@/services/credentials', () => ({ aUnConnecteurAgenda }))
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
  // Remplace `getMonthEntries` : la page lit désormais une seule plage de
  // trois mois plutôt qu'un seul mois, pour construire les trois vues sans
  // tripler la requête.
  getEntriesRange: async () => [],
  getLineEngagementTotals: async () => ({ l1: [] }),
  getPastForecastWithLockStatus: async () => ({ entries: [], lockedCount: 0 }),
}))
vi.mock('./actions', () => ({
  saveCell: vi.fn(),
  appliquerCase,
  remplirMois: vi.fn(),
  viderMois: vi.fn(),
  validerJoursPasses: vi.fn(),
  verifierAgenda: vi.fn(),
}))
// `monthLabel` reste réel : la vue 3 mois de `SaisieClient` s'en sert pour
// nommer chacune de ses trois grilles, et un mock complet le ferait
// disparaître avec `MonthNav`.
vi.mock('@/components/MonthNav', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/MonthNav')>()),
  MonthNav: () => null,
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import SaisiePage from './page'

async function rendre(): Promise<void> {
  render(await SaisiePage({ params: Promise.resolve({ month: '2026-03' }), searchParams: Promise.resolve({}) }))
}

describe('page de saisie — plus de lecture automatique de l agenda', () => {
  beforeEach(() => {
    agendaEspion.mockReset()
    aUnConnecteurAgenda.mockReset().mockResolvedValue(false)
    appliquerCase.mockReset()
    window.localStorage.clear()
  })
  afterEach(cleanup)

  // Le test qui porte toute la section G. Parcourir douze mois coutait douze
  // appels freeBusy, pour un repere qu'on ne regardait peut-etre pas.
  it('n appelle pas Google en ouvrant le mois', async () => {
    await SaisiePage({
      params: Promise.resolve({ month: '2026-03' }),
      searchParams: Promise.resolve({}),
    })

    expect(agendaEspion).not.toHaveBeenCalled()
  })

  // La promesse du lot ne change pas : l'absence de marquage n'empêche jamais
  // de saisir, seule sa source change (un clic, plus le rendu de la page).
  it('affiche la grille sans marques et laisse saisir normalement', async () => {
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

  it('offre le bouton de vérification quand un connecteur est configuré', async () => {
    aUnConnecteurAgenda.mockResolvedValue(true)
    await rendre()

    expect(screen.getByRole('button', { name: /Vérifier l’agenda/ })).toBeDefined()
  })

  // Un bouton qui échouerait à tous les coups n'apprendrait rien à personne.
  it('n offre pas le bouton quand aucun connecteur n est configuré', async () => {
    aUnConnecteurAgenda.mockResolvedValue(false)
    await rendre()

    expect(screen.queryByRole('button', { name: /Vérifier l’agenda/ })).toBeNull()
  })
})

/**
 * Trois gabarits cohabitaient : la barre en `max-w-4xl`, `PageShell` en
 * `max-w-5xl`, et cet écran sans gabarit du tout. Le bord gauche du contenu
 * sautait donc d'un écran à l'autre.
 */
describe('page de saisie — le gabarit commun', () => {
  beforeEach(() => {
    aUnConnecteurAgenda.mockReset().mockResolvedValue(false)
    window.localStorage.clear()
  })
  afterEach(cleanup)

  it('rend la saisie dans le gabarit commun', async () => {
    await rendre()

    const titre = screen.getByRole('heading', { level: 1, name: 'Saisie' })
    expect(titre.className).toContain('text-2xl')
    // Un `h1` en `text-xl font-semibold` était une étiquette en gras, pas un
    // titre : ×1,29 du corps. Le gabarit le porte à ×1,57.
    expect(titre.className).not.toContain('text-xl')
  })

  it('lui donne la largeur et la marge de tous les autres écrans', async () => {
    const { container } = render(
      await SaisiePage({ params: Promise.resolve({ month: '2026-03' }), searchParams: Promise.resolve({}) }),
    )

    // C'est `<main>` qui porte la marge : le test de budget des sept colonnes
    // la lit dans `PageShell.tsx`, et un écran qui déclarerait la sienne
    // mesurerait un budget que personne n'applique.
    const principal = container.querySelector('main')!
    expect(principal.className).toContain('max-w-[100rem]')
    expect(principal.className).toContain('p-4')
  })
})

/**
 * Tâche 14 — la vue 3 mois : le mois choisi et les deux suivants, en grilles
 * compactes côte à côte. Atteinte par `?vue=3mois`, exactement comme
 * `?vue=tableau` l'est déjà.
 */
describe('page de saisie — la vue 3 mois', () => {
  beforeEach(() => {
    agendaEspion.mockReset()
    aUnConnecteurAgenda.mockReset().mockResolvedValue(false)
    appliquerCase.mockReset()
    window.localStorage.clear()
  })
  afterEach(cleanup)

  async function rendreEnTroisMois(month: string): Promise<void> {
    render(
      await SaisiePage({
        params: Promise.resolve({ month }),
        searchParams: Promise.resolve({ vue: '3mois' }),
      }),
    )
  }

  it('resout la vue 3 mois depuis l adresse', async () => {
    await rendreEnTroisMois('2026-03')

    expect(screen.getByRole('button', { name: '3 mois' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('montre le mois choisi et les deux suivants', async () => {
    await rendreEnTroisMois('2026-11')

    expect(screen.getByText('novembre 2026')).toBeTruthy()
    expect(screen.getByText('décembre 2026')).toBeTruthy()
    // Le passage d'année n'a pas de cas particulier : `shiftMonth` le gère.
    expect(screen.getByText('janvier 2027')).toBeTruthy()
  })

  it('ecrit a la bonne date quand on clique dans le troisieme mois', async () => {
    appliquerCase.mockResolvedValue({ ok: true, state: { kind: 'JOURNEE' } })
    await rendreEnTroisMois('2026-03')

    // La troisième grille est mai : cliquer là doit écrire sur mai, pas sur
    // le mois choisi ni sur celui du milieu.
    fireEvent.click(screen.getByTestId('case-2026-05-12'))

    await waitFor(() =>
      expect(appliquerCase).toHaveBeenCalledWith(
        expect.objectContaining({ date: '2026-05-12' }),
      ),
    )
  })

  // Vingt et une colonnes ne tiennent pas sur un téléphone. Le calendrier
  // reste la surface de saisie mobile.
  it('n est pas atteignable sous md', async () => {
    await rendreEnTroisMois('2026-03')

    expect(screen.getByRole('button', { name: '3 mois' }).className).toContain('hidden md:')
  })
})
