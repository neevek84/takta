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
      journeeDebutMinute={540}
      journeeFinMinute={1080}
      {...overrides}
    />,
  )
}

/** Deux journées pleines le 12 : de quoi dépasser une capacité d'une journée. */
const deuxJournees: MonthEntry[] = [
  { id: 'e1', lineId: 'l1', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '', startMinute: 540, endMinute: 1020, minutesParJour: 480 },
  { id: 'e2', lineId: 'l2', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '', startMinute: 540, endMinute: 1020, minutesParJour: 480 },
]

/** La vue tableau n'est plus la vue par défaut : ces tests l'ouvrent d'abord. */
function ouvrirTableau(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Tableau multi-CRA' }))
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

  // Une saisie est identifiée par son heure de début : deux blocs partis à la
  // même minute se superposeraient dans l'agenda. Le refus dit laquelle, et à
  // quelle heure — « saisie invalide » n'apprendrait rien.
  it('dit à quelle heure une autre saisie occupe déjà la place', async () => {
    saveCell.mockResolvedValue({ ok: false, reason: 'CHEVAUCHEMENT', startMinute: 540 })
    renderClient()
    ouvrirTableau()
    const input = saisir('0,5')

    await waitFor(() => expect(screen.getByText(/commence déjà à 9 h 00/)).toBeDefined())
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

  // C3 — le réalisé est ce qui est attesté au client et facturé : c'est
  // l'horloge du serveur qui le départage du prévisionnel, jamais celle du
  // navigateur. Le `toHaveBeenCalledWith` compare l'objet entier : un `kind`
  // recalculé côté client le ferait échouer.
  it("n'envoie aucun kind au serveur : la vue tableau ne décide pas du réalisé", async () => {
    saveCell.mockResolvedValue({ ok: true, minutes: 480 })
    renderClient()
    ouvrirTableau()
    saisir('1')

    await waitFor(() =>
      expect(saveCell).toHaveBeenCalledWith({
        lineId: 'l1',
        date: '2026-03-12',
        raw: '1',
        month: '2026-03',
        // Le créneau, lui, vient bien du client : c'est un choix de saisie, pas
        // une décision sur la nature du temps. Vide = journée entière.
        slotId: '',
      }),
    )
  })

  // I2 — le dépassement se juge au millicentième, l'affichage montre des
  // centièmes : à 481 minutes contre 480, le refus s'écrivait « 1 j saisis
  // pour une capacité de 1 j », c'est-à-dire une contradiction. Le nombre ne
  // bouge pas — l'arrondir vers le haut le désaccorderait du bandeau et de la
  // ligne de totaux — c'est la phrase qui cesse de prétendre à l'égalité.
  it('ne prétend pas à l égalité quand le dépassement se perd dans l arrondi', async () => {
    saveCell.mockResolvedValue({
      ok: false,
      reason: 'CAPACITE',
      totalCentiemes: 100,
      capacityCentiemes: 100,
    })
    renderClient()
    ouvrirTableau()
    saisir('1')

    const message = await screen.findByText(/Capacité dépassée/)
    expect(message.textContent).not.toContain('1 j saisis pour une capacité de 1 j')
    expect(message.textContent).toContain('capacité de 1 j')
    expect(message.textContent).toContain('trop petite pour')
    expect(message.textContent).toContain('refusée')
  })

  it('garde les deux nombres quand le dépassement se voit à l affichage', async () => {
    saveCell.mockResolvedValue({
      ok: false,
      reason: 'CAPACITE',
      totalCentiemes: 114,
      capacityCentiemes: 100,
    })
    renderClient()
    ouvrirTableau()
    saisir('1')

    const message = await screen.findByText(/Capacité dépassée/)
    expect(message.textContent).toContain('1,14 j saisis pour une capacité de 1 j')
  })

  // Tâche 12 — un créneau que la prestation ne prévoit pas est signalé, jamais
  // refusé : la saisie reste à l'écran et le message dit qu'elle est conservée.
  describe('créneau non prévu, vue tableau', () => {
    // Le bug corrigé : le tableau affichait l'identifiant brut du créneau
    // (« nuit ») là où le calendrier affiche le libellé réglé en
    // administration (« Nuit (20 h – 4 h) »). Comparaison exacte de la phrase
    // entière : un `toContain` sur un fragment court laisserait passer
    // n'importe quel texte qui le contiendrait, y compris l'ancien.
    it('signale le créneau avec le libellé réglé en administration, pas l’identifiant', async () => {
      saveCell.mockResolvedValue({
        ok: true,
        minutes: 240,
        slotWarning: { slotId: 'matin', allowedSlotIds: ['nuit'] },
      })
      renderClient({
        slots: [
          { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
          {
            id: 'nuit',
            label: 'Nuit (20 h – 4 h)',
            startMinute: 1200,
            endMinute: 240,
            centiemes: 50,
          },
        ],
      })
      ouvrirTableau()
      const input = saisir('0,5')

      const message = await screen.findByText(
        'Ce créneau n’est pas prévu pour cette ligne (créneaux prévus : Nuit (20 h – 4 h)). La saisie est conservée.',
      )
      expect(input.value).toBe('0,5')

      // Signalement et non refus : la tonalité n'est pas celle d'un rejet.
      const bandeau = message.closest('[role="alert"]')
      expect(bandeau).not.toBeNull()
      expect(bandeau!.className).toContain('bg-warning')
      expect(bandeau!.className).not.toContain('bg-danger')
    })

    // Un créneau peut avoir été retiré des réglages après la saisie : son
    // libellé n'existe plus nulle part côté client non plus. Le message doit
    // retomber sur l'identifiant, jamais s'effacer ni afficher « undefined ».
    it('retombe sur l’identifiant quand le créneau a été supprimé des réglages', async () => {
      saveCell.mockResolvedValue({
        ok: true,
        minutes: 240,
        slotWarning: { slotId: 'matin', allowedSlotIds: ['soiree-disparue'] },
      })
      renderClient({ slots: DEFAULT_SLOTS })
      ouvrirTableau()
      saisir('0,5')

      const message = await screen.findByText(
        'Ce créneau n’est pas prévu pour cette ligne (créneaux prévus : soiree-disparue). La saisie est conservée.',
      )
      expect(message.textContent).not.toMatch(/undefined/)
    })

    it('transmet au serveur le créneau choisi dans la grille', async () => {
      saveCell.mockResolvedValue({ ok: true, minutes: 240 })
      renderClient()
      ouvrirTableau()
      fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM'), {
        target: { value: 'matin' },
      })
      saisir('0,5')

      await waitFor(() =>
        expect(saveCell).toHaveBeenCalledWith({
          lineId: 'l1',
          date: '2026-03-12',
          raw: '0,5',
          month: '2026-03',
          slotId: 'matin',
        }),
      )
    })
  })

  // M5 — un refus et un avertissement ne se ressemblent pas.
  it('annonce un refus en tonalité danger', async () => {
    saveCell.mockResolvedValue({ ok: false, reason: 'VERROUILLE' })
    renderClient()
    ouvrirTableau()
    saisir('0,5')

    const bandeau = (await screen.findByText(/CRA de ce mois est validé/)).closest(
      '[role="alert"]',
    )
    expect(bandeau).not.toBeNull()
    expect(bandeau!.className).toContain('bg-danger')
    expect(bandeau!.className).not.toContain('bg-warning')
  })

  it('garde la tonalité avertissement pour une saisie conservée', async () => {
    saveCell.mockResolvedValue({
      ok: true,
      minutes: 240,
      warning: { totalCentiemes: 150, capacityCentiemes: 100 },
    })
    renderClient()
    ouvrirTableau()
    saisir('0,5')

    const bandeau = (await screen.findByText(/Capacité dépassée/)).closest('[role="alert"]')
    expect(bandeau).not.toBeNull()
    expect(bandeau!.className).toContain('bg-warning')
    expect(bandeau!.className).not.toContain('bg-danger')
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
    expect(screen.getByRole('button', { name: 'Tableau multi-CRA' }).className).toContain('hidden')
    expect(screen.getByRole('button', { name: 'Tableau multi-CRA' }).className).toContain(
      'md:inline-flex',
    )
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

  // « Tout le mois » annonçait une portée de temps ; la bascule porte une
  // portée de prestations — afficher, ou non, les autres à côté de celle
  // qu'on saisit. Le libellé dit désormais la chose.
  it('bascule entre « Cette prestation » et « Toutes les prestations »', () => {
    renderClient()
    expect(screen.getByRole('button', { name: 'Cette prestation' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Toutes les prestations' }))
    expect(
      screen.getByRole('button', { name: 'Toutes les prestations' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByRole('button', { name: 'Cette prestation' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('n annonce plus une portée de temps', () => {
    renderClient()
    expect(screen.queryByRole('button', { name: 'Tout le mois' })).toBeNull()
  })

  // La bascule n'est transmise qu'au calendrier : en mode tableau, elle
  // n'avait aucun effet. Un réglage sans effet visible apprend à
  // l'utilisateur que l'interface ment.
  it('retire la bascule de portée en mode tableau', () => {
    renderClient()
    expect(screen.getByRole('button', { name: 'Cette prestation' })).toBeDefined()

    ouvrirTableau()
    expect(screen.queryByRole('button', { name: 'Cette prestation' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Toutes les prestations' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Calendrier' }))
    expect(screen.getByRole('button', { name: 'Cette prestation' })).toBeDefined()
  })

  // Le tableau montre toutes les missions et prestations auxquelles on est
  // affecté : c'est sa nature, et son nom doit le dire.
  it('nomme le tableau comme la vue multi-CRA', () => {
    renderClient()
    expect(screen.getByRole('button', { name: /multi-CRA/ })).toBeDefined()

    ouvrirTableau()
    expect(screen.getByTestId('nature-tableau').textContent).toContain(
      'toutes les missions et prestations',
    )
  })

  // Le jour courant vient de la page, jamais de l'horloge du navigateur : le
  // rendu serveur et le rendu client doivent tomber d'accord.
  it('marque la case du jour courant dans le calendrier', () => {
    renderClient({ aujourdhui: '2026-03-12' })
    expect(screen.getByTestId('case-2026-03-12').getAttribute('data-aujourdhui')).toBe('true')
    expect(screen.getByTestId('case-2026-03-13').getAttribute('data-aujourdhui')).toBeNull()
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
      const message = await screen.findByText(
        "Le CRA de ce mois est validé : aucun jour n'a été posé.",
      )
      // M5 — rien n'a été posé : c'est un refus, pas un avertissement.
      expect(message.closest('[role="alert"]')!.className).toContain('bg-danger')
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

  /**
   * C2 — le raccourci et la boîte qu'il ouvre sont une seule fonctionnalité.
   * Maj+Entrée sur une case ouvre le formulaire d'heures, le seul moyen de
   * placer un bloc dans la journée : le focus doit y entrer, et en revenir.
   */
  it('ouvre le formulaire au clavier, y porte le focus, et le rend à la case sur Échap', () => {
    renderClient()
    const caseDu12 = screen.getByTestId('case-2026-03-12')
    caseDu12.focus()
    expect(document.activeElement).toBe(caseDu12)

    fireEvent.keyDown(caseDu12, { key: 'Enter', shiftKey: true })

    // Zéro tabulation : le champ est atteint par le raccourci lui-même.
    const debut = screen.getByLabelText('Heure de début')
    expect(document.activeElement).toBe(debut)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByLabelText('Heure de début')).toBeNull()
    expect(document.activeElement).toBe(caseDu12)
  })

  it('ouvre le formulaire au clic droit et l applique', async () => {
    appliquerCase.mockResolvedValue({
      ok: true,
      state: { kind: 'LIBRE', minutes: 180, slotId: '', startMinute: 540, endMinute: 720, eclatee: false },
    })
    renderClient()

    fireEvent.contextMenu(screen.getByTestId('case-2026-03-12'))
    // Le formulaire reçoit les créneaux réglés, pas une liste vide.
    expect(screen.getByRole('option', { name: 'Matin (AM)' })).toBeDefined()
    fireEvent.change(screen.getByLabelText('Heure de début'), { target: { value: '09:00' } })
    fireEvent.change(screen.getByLabelText('Heure de fin'), { target: { value: '12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() =>
      expect(appliquerCase).toHaveBeenCalledWith({
        lineId: 'l1',
        date: '2026-03-12',
        state: { kind: 'LIBRE', minutes: 180, slotId: '', startMinute: 540, endMinute: 720, eclatee: false },
        month: '2026-03',
      }),
    )
  })
})

/**
 * L'occupation de l'agenda est un repère, jamais un verrou : elle se marque
 * dans les deux vues et s'annonce sans rien refuser.
 */
describe('SaisieClient — occupation de l agenda', () => {
  beforeEach(() => {
    saveCell.mockReset()
    appliquerCase.mockReset()
    window.localStorage.clear()
  })
  afterEach(cleanup)

  it('marque le jour occupé dans la vue calendrier', () => {
    // Sous `md`, la vue tableau est masquée : si le marquage n'existait que
    // là, il n'existerait pas au téléphone.
    renderClient({ busyDates: ['2026-03-12'] })
    expect(screen.getByTestId('case-2026-03-12').getAttribute('data-busy')).toBe('true')
    expect(screen.getByTestId('case-2026-03-13').getAttribute('data-busy')).toBeNull()
  })

  it('marque le jour occupé dans la vue tableau', () => {
    renderClient({ busyDates: ['2026-03-12'] })
    ouvrirTableau()
    expect(screen.getByTestId('day-header-2026-03-12').getAttribute('data-busy')).toBe('true')
    expect(screen.getByTestId('day-header-2026-03-13').getAttribute('data-busy')).toBeNull()
  })

  it('ne marque rien quand la lecture d occupation a échoué', () => {
    // `getBusyDays` ne lève jamais : elle rend une liste vide, et la page
    // s'affiche exactement comme si l'agenda n'était pas connecté.
    renderClient({ busyDates: [] })
    expect(screen.getByTestId('case-2026-03-12').getAttribute('data-busy')).toBeNull()
    ouvrirTableau()
    expect(screen.getByTestId('day-header-2026-03-12').getAttribute('data-busy')).toBeNull()
  })

  it('avertit sans bloquer quand on saisit sur un jour occupé — vue tableau', async () => {
    saveCell.mockResolvedValue({ ok: true, minutes: 480 })
    renderClient({ busyDates: ['2026-03-12'] })
    ouvrirTableau()

    const input = saisir('1')

    const message = await screen.findByText(
      'Votre agenda est déjà occupé le 2026-03-12. La saisie est conservée.',
    )
    // Une information, pas une alerte : `status` attend le moment opportun.
    expect(message.closest('[role="status"]')).not.toBeNull()
    // Non bloquant : la valeur reste à l'écran et l'action a bien été appelée.
    expect(input.value).toBe('1')
    expect(saveCell).toHaveBeenCalledTimes(1)
  })

  it('avertit sans bloquer quand on saisit sur un jour occupé — vue calendrier', async () => {
    appliquerCase.mockResolvedValue({ ok: true, state: { kind: 'JOURNEE' } })
    renderClient({ busyDates: ['2026-03-12'] })

    fireEvent.click(screen.getByTestId('case-2026-03-12'))

    await waitFor(() =>
      expect(
        screen.getByText('Votre agenda est déjà occupé le 2026-03-12. La saisie est conservée.'),
      ).toBeDefined(),
    )
    // La saisie tient : le « 1 » optimiste n'est pas retiré.
    expect(screen.getByTestId('valeur-2026-03-12').textContent).toBe('1')
    expect(appliquerCase).toHaveBeenCalledTimes(1)
  })

  it('n avertit pas sur un jour libre', async () => {
    saveCell.mockResolvedValue({ ok: true, minutes: 480 })
    renderClient({ busyDates: ['2026-03-13'] })
    ouvrirTableau()

    saisir('1')

    await waitFor(() => expect(saveCell).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/agenda est déjà occupé/)).toBeNull()
  })

  it('laisse le message de capacité l emporter', async () => {
    // Un dépassement de capacité est plus important qu'une simple occupation.
    saveCell.mockResolvedValue({
      ok: true,
      minutes: 480,
      warning: { totalCentiemes: 150, capacityCentiemes: 100 },
    })
    renderClient({ busyDates: ['2026-03-12'] })
    ouvrirTableau()

    saisir('1')

    const message = await screen.findByText(/Capacité dépassée/)
    expect(message.textContent).toContain('conservée')
    expect(screen.queryByText(/agenda est déjà occupé/)).toBeNull()
  })

  it('laisse le signalement de créneau l emporter — vue calendrier', async () => {
    appliquerCase.mockResolvedValue({
      ok: true,
      state: { kind: 'JOURNEE' },
      signalement:
        'Créneau hors des créneaux autorisés pour cette prestation : Nuit. La saisie est conservée.',
    })
    renderClient({ busyDates: ['2026-03-12'] })

    fireEvent.click(screen.getByTestId('case-2026-03-12'))

    await waitFor(() => expect(screen.getByText(/hors des créneaux autorisés/)).toBeDefined())
    expect(screen.queryByText(/agenda est déjà occupé/)).toBeNull()
  })

  it('ne transforme pas un refus en simple occupation', async () => {
    // Le refus dit que rien n'a été enregistré : le recouvrir d'un message
    // d'occupation ferait croire à une saisie conservée.
    saveCell.mockResolvedValue({ ok: false, reason: 'VERROUILLE' })
    renderClient({ busyDates: ['2026-03-12'] })
    ouvrirTableau()

    saisir('1')

    await waitFor(() => expect(screen.getByText(/CRA de ce mois est validé/)).toBeDefined())
    expect(screen.queryByText(/agenda est déjà occupé/)).toBeNull()
  })
})
