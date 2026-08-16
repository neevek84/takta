// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { buildMonthDays } from '@/core/month/build'
import { DEFAULT_SLOTS } from '@/services/settings'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'

const { saveCell, appliquerCase, remplirMois, viderMois } = vi.hoisted(() => ({
  saveCell: vi.fn(),
  appliquerCase: vi.fn(),
  remplirMois: vi.fn(),
  viderMois: vi.fn(),
}))
vi.mock('./actions', () => ({ saveCell, appliquerCase, remplirMois, viderMois }))

// `vi.mock` est hissé au-dessus des imports : les server actions ne sont
// jamais chargées, seul le composant l'est.
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
  {
    id: 'l2',
    label: 'Consultant ITSM Nuit',
    missionLabel: 'ITSM',
    clientName: 'ACME',
    displayUnit: 'JOUR',
    minutesParJour: 480,
    soldCentiemes: 1000,
    allowedSlotIds: [],
  },
]

function renderClient(
  overrides: Partial<React.ComponentProps<typeof SaisieClient>> = {},
): void {
  render(
    <SaisieClient
      month="2026-03"
      days={buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])}
      lines={lines}
      entries={[]}
      engagementTotals={{ l1: [], l2: [] }}
      capacityCentiemes={100}
      capacityMode="AVERTISSEMENT"
      slots={DEFAULT_SLOTS}
      {...overrides}
    />,
  )
}

/** Deux journées pleines le 12 : de quoi dépasser une capacité d'une journée. */
const deuxJournees: MonthEntry[] = [
  { id: 'e1', lineId: 'l1', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '', minutesParJour: 480 },
  { id: 'e2', lineId: 'l2', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '', minutesParJour: 480 },
]

/** La vue tableau n'est plus la vue par défaut : ces tests l'ouvrent d'abord. */
function ouvrirTableau(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Tableau' }))
}

function saisir(valeur: string): HTMLInputElement {
  const input = screen.getByLabelText('Consultant ITSM 2026-03-12') as HTMLInputElement
  fireEvent.change(input, { target: { value: valeur } })
  fireEvent.blur(input)
  return input
}

describe('SaisieClient', () => {
  beforeEach(() => {
    saveCell.mockReset()
    appliquerCase.mockReset()
    remplirMois.mockReset()
    viderMois.mockReset()
    window.localStorage.clear()
  })
  afterEach(cleanup)

  // I1 — en mode AVERTISSEMENT, le dépassement est signalé sans être bloqué.
  it('affiche le dépassement signalé sans effacer la saisie', async () => {
    saveCell.mockResolvedValue({
      ok: true,
      minutes: 240,
      warning: { totalCentiemes: 150, capacityCentiemes: 100 },
    })
    renderClient()
    ouvrirTableau()
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
    ouvrirTableau()
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
    ouvrirTableau()
    const input = saisir('0,5')

    const message = await screen.findByText(/Capacité dépassée/)
    expect(message.textContent).toContain('1,14 j saisis pour une capacité de 1 j')
    expect(message.textContent).toContain('refusée')
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('affiche le verrouillage du mois et vide la cellule refusée', async () => {
    saveCell.mockResolvedValue({ ok: false, reason: 'VERROUILLE' })
    renderClient()
    ouvrirTableau()
    const input = saisir('0,5')

    await waitFor(() => expect(screen.getByText(/CRA de ce mois est validé/)).toBeDefined())
    await waitFor(() => expect(input.value).toBe(''))
  })

  it("affiche l'absence d'affectation sur la ligne", async () => {
    saveCell.mockResolvedValue({ ok: false, reason: 'NON_AFFECTE' })
    renderClient()
    ouvrirTableau()
    saisir('0,5')

    await waitFor(() => expect(screen.getByText(/affecté/)).toBeDefined())
  })

  it('affiche la saisie invalide et vide la cellule', async () => {
    saveCell.mockResolvedValue({ ok: false, reason: 'SAISIE_INVALIDE' })
    renderClient()
    ouvrirTableau()
    const input = saisir('abc')

    await waitFor(() => expect(screen.getByText(/Saisie invalide/)).toBeDefined())
    await waitFor(() => expect(input.value).toBe(''))
  })
})

describe('SaisieClient — calendrier', () => {
  beforeEach(() => {
    appliquerCase.mockReset()
    remplirMois.mockReset()
    viderMois.mockReset()
    window.localStorage.clear()
  })
  afterEach(cleanup)

  it('ouvre la vue calendrier par défaut', () => {
    renderClient()
    expect(screen.getByTestId('grille-calendrier')).toBeDefined()
    expect(screen.queryByLabelText('Consultant ITSM 2026-03-12')).toBeNull()
  })

  it('bascule vers la vue tableau et la ramène', () => {
    renderClient()
    ouvrirTableau()
    expect(screen.getByLabelText('Consultant ITSM 2026-03-12')).toBeDefined()
    expect(screen.queryByTestId('grille-calendrier')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Calendrier' }))
    expect(screen.getByTestId('grille-calendrier')).toBeDefined()
    expect(screen.queryByLabelText('Consultant ITSM 2026-03-12')).toBeNull()
  })

  it('réserve la vue tableau au poste', () => {
    renderClient()
    // Sept colonnes tiennent sur un téléphone ; trente et une, non.
    expect(screen.getByRole('button', { name: 'Tableau' }).className).toContain('hidden')
    expect(screen.getByRole('button', { name: 'Tableau' }).className).toContain('md:inline-flex')
    // La vue calendrier, elle, reste offerte partout : la reléguer aussi au
    // poste ne laisserait aucune vue au téléphone.
    expect(screen.getByRole('button', { name: 'Calendrier' }).className).not.toContain('hidden')
  })

  // Le mode et le seuil traversent la page, le client et la grille avant
  // d'atteindre la ligne de totaux : les figer quelque part en chemin remet
  // l'écran en désaccord avec le service.
  it('fait descendre le mode de capacité jusqu à la vue tableau', () => {
    renderClient({ entries: deuxJournees, capacityMode: 'DESACTIVE' })
    ouvrirTableau()
    expect(screen.getByTestId('total-2026-03-12').getAttribute('data-depassement')).toBe('false')
  })

  it('marque le dépassement en vue tableau quand le mode le demande', () => {
    renderClient({ entries: deuxJournees, capacityMode: 'BLOCAGE' })
    ouvrirTableau()
    expect(screen.getByTestId('total-2026-03-12').getAttribute('data-depassement')).toBe('true')
  })

  it('applique la cinématique par le server action', async () => {
    appliquerCase.mockResolvedValue({ ok: true, state: { kind: 'JOURNEE' } })
    renderClient()

    fireEvent.click(screen.getByTestId('case-2026-03-12'))
    await waitFor(() =>
      expect(appliquerCase).toHaveBeenCalledWith({
        lineId: 'l1',
        date: '2026-03-12',
        state: { kind: 'JOURNEE' },
        month: '2026-03',
      }),
    )
  })

  // Le deuxième cran est une demi-journée sur le premier créneau réglé : sans
  // les créneaux, la cinématique retomberait directement sur « vide ». C'est
  // la preuve que `slots` traverse bien jusqu'au calendrier.
  it('propose la demi-journée du premier créneau au deuxième clic', async () => {
    appliquerCase.mockResolvedValue({ ok: true, state: { kind: 'JOURNEE' } })
    renderClient()

    fireEvent.click(screen.getByTestId('case-2026-03-12'))
    await waitFor(() => expect(appliquerCase).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByTestId('case-2026-03-12'))

    await waitFor(() =>
      expect(appliquerCase).toHaveBeenLastCalledWith({
        lineId: 'l1',
        date: '2026-03-12',
        state: { kind: 'DEMI', slotId: 'matin' },
        month: '2026-03',
      }),
    )
  })

  it('affiche le signalement d un créneau non autorisé sans effacer la saisie', async () => {
    appliquerCase.mockResolvedValue({
      ok: true,
      state: { kind: 'JOURNEE' },
      signalement:
        'Créneau hors des créneaux autorisés pour cette prestation : Nuit. La saisie est conservée.',
    })
    renderClient()

    fireEvent.click(screen.getByTestId('case-2026-03-12'))
    await waitFor(() => expect(screen.getByText(/hors des créneaux autorisés/)).toBeDefined())
    // `toBe` et non `toContain` : « 1 » est contenu dans « 0,1 » comme dans
    // « 12 », et la case porte son numéro de jour juste au-dessus.
    expect(screen.getByTestId('valeur-2026-03-12').textContent).toBe('1')
  })

  it('affiche le refus d un mois verrouillé', async () => {
    appliquerCase.mockResolvedValue({ ok: false, reason: 'VERROUILLE' })
    renderClient()

    fireEvent.click(screen.getByTestId('case-2026-03-12'))
    await waitFor(() => expect(screen.getByText(/CRA de ce mois est validé/)).toBeDefined())
    // Le refus retire l'affichage optimiste : laisser le « 1 » ferait croire
    // à une saisie enregistrée.
    await waitFor(() => expect(screen.getByTestId('valeur-2026-03-12').textContent).toBe(''))
  })

  it('bascule entre « Cette prestation » et « Tout le mois »', () => {
    renderClient()
    expect(screen.getByRole('button', { name: 'Cette prestation' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Tout le mois' }))
    expect(screen.getByRole('button', { name: 'Tout le mois' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: 'Cette prestation' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('change de prestation par le sélecteur', () => {
    renderClient()
    fireEvent.change(screen.getByLabelText('Prestation'), { target: { value: 'l2' } })
    expect((screen.getByLabelText('Prestation') as HTMLSelectElement).value).toBe('l2')
  })

  it('adresse la cinématique à la prestation sélectionnée', async () => {
    appliquerCase.mockResolvedValue({ ok: true, state: { kind: 'JOURNEE' } })
    renderClient()
    fireEvent.change(screen.getByLabelText('Prestation'), { target: { value: 'l2' } })

    fireEvent.click(screen.getByTestId('case-2026-03-12'))
    await waitFor(() =>
      expect(appliquerCase).toHaveBeenCalledWith({
        lineId: 'l2',
        date: '2026-03-12',
        state: { kind: 'JOURNEE' },
        month: '2026-03',
      }),
    )
  })

  describe('Remplir le CRA', () => {
    it('rend compte de ce qui a été posé et sauté', async () => {
      remplirMois.mockResolvedValue({ poses: 18, sautesCapacite: 2, dejaSaisis: 0, verrouille: false })
      renderClient()

      fireEvent.click(screen.getByRole('button', { name: 'Remplir le CRA' }))
      await waitFor(() =>
        expect(screen.getByText('18 jours posés, 2 sautés faute de capacité.')).toBeDefined(),
      )
      expect(remplirMois).toHaveBeenCalledWith({ lineId: 'l1', month: '2026-03' })
    })

    it('dit le verrou plutôt que de laisser croire à un remplissage', async () => {
      remplirMois.mockResolvedValue({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: true })
      renderClient()

      fireEvent.click(screen.getByRole('button', { name: 'Remplir le CRA' }))
      await waitFor(() =>
        expect(screen.getByText("Le CRA de ce mois est validé : aucun jour n'a été posé.")).toBeDefined(),
      )
    })
  })

  describe('Vider le CRA', () => {
    it('demande confirmation avant de rien retirer', () => {
      renderClient()
      fireEvent.click(screen.getByRole('button', { name: 'Vider le CRA' }))

      expect(screen.getByRole('button', { name: 'Confirmer le vidage' })).toBeDefined()
      expect(viderMois).not.toHaveBeenCalled()
    })

    it('renonce sans rien retirer', () => {
      renderClient()
      fireEvent.click(screen.getByRole('button', { name: 'Vider le CRA' }))
      fireEvent.click(screen.getByRole('button', { name: 'Annuler le vidage' }))

      expect(screen.queryByRole('button', { name: 'Confirmer le vidage' })).toBeNull()
      expect(viderMois).not.toHaveBeenCalled()
    })

    it('vide et rend compte après confirmation', async () => {
      viderMois.mockResolvedValue({ supprimees: 22, verrouille: false })
      renderClient()

      fireEvent.click(screen.getByRole('button', { name: 'Vider le CRA' }))
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer le vidage' }))

      await waitFor(() => expect(screen.getByText('22 saisies retirées.')).toBeDefined())
      expect(viderMois).toHaveBeenCalledWith({ lineId: 'l1', month: '2026-03' })
      // Le panneau se referme : le laisser ouvert invite à vider deux fois.
      expect(screen.queryByRole('button', { name: 'Confirmer le vidage' })).toBeNull()
    })

    it('dit le verrou', async () => {
      viderMois.mockResolvedValue({ supprimees: 0, verrouille: true })
      renderClient()

      fireEvent.click(screen.getByRole('button', { name: 'Vider le CRA' }))
      fireEvent.click(screen.getByRole('button', { name: 'Confirmer le vidage' }))

      await waitFor(() =>
        expect(
          screen.getByText("Le CRA de ce mois est validé : aucune saisie n'a été retirée."),
        ).toBeDefined(),
      )
    })
  })

  it('restaure la prestation mémorisée au montage', async () => {
    window.localStorage.setItem('cra.saisie.prestation', 'l2')
    renderClient()
    await waitFor(() =>
      expect((screen.getByLabelText('Prestation') as HTMLSelectElement).value).toBe('l2'),
    )
  })

  it('ouvre le formulaire au clic droit et l applique', async () => {
    appliquerCase.mockResolvedValue({
      ok: true,
      state: { kind: 'LIBRE', minutes: 180, slotId: '', eclatee: false },
    })
    renderClient()

    fireEvent.contextMenu(screen.getByTestId('case-2026-03-12'))
    // Le formulaire reçoit les créneaux réglés, pas une liste vide.
    expect(screen.getByRole('option', { name: 'Matin' })).toBeDefined()
    fireEvent.change(screen.getByLabelText('Durée (heures)'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() =>
      expect(appliquerCase).toHaveBeenCalledWith({
        lineId: 'l1',
        date: '2026-03-12',
        state: { kind: 'LIBRE', minutes: 180, slotId: '', eclatee: false },
        month: '2026-03',
      }),
    )
  })
})
