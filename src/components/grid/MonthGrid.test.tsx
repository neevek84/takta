// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MonthGrid } from './MonthGrid'
// L'autre vue du même écran : ce test-ci compare ce que les deux peignent du
// prévisionnel, il ne la modifie pas.
import { MonthCalendar } from '@/components/calendar/MonthCalendar'
import { colorForLine, PREVU_COLOR } from '@/core/saisie/colors'
import { DEFAULT_SLOTS } from '@/services/settings'
import { buildMonthDays } from '@/core/month/build'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals, MonthEntry } from '@/services/time-entries'

const days = buildMonthDays('2026-03', [1, 2, 3, 4, 5], [])

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
    displayUnit: 'HEURE',
    minutesParJour: 480,
    soldCentiemes: 1000,
    allowedSlotIds: ['nuit'],
  },
]

/**
 * Bornes figées d'une saisie (lot 1f). Le tableau ne les lit pas — il montre
 * des durées, pas des placements — mais le type de `MonthEntry` les exige :
 * elles sont ce qui identifie une saisie en base et ce qui part dans l'agenda.
 */
const BORNES = { startMinute: 540, endMinute: 1020 }

// `minutesParJour` est figé sur chaque saisie depuis le lot 1d : les deux
// lignes du jeu d'essai travaillent en journées de 8 h.
const entries: MonthEntry[] = [
  { id: 'e1', lineId: 'l1', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '', ...BORNES, minutesParJour: 480 },
  { id: 'e2', lineId: 'l2', date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'nuit', ...BORNES, minutesParJour: 480 },
]

const engagementTotals: Record<string, LineEngagementTotals> = {
  l1: [{ kind: 'REALISE', minutes: 480, minutesParJour: 480 }],
  l2: [{ kind: 'REALISE', minutes: 240, minutesParJour: 480 }],
}

function renderGrid(
  overrides: Partial<React.ComponentProps<typeof MonthGrid>> = {},
): ReturnType<typeof render> {
  return render(
    <MonthGrid
      days={days}
      lines={lines}
      entries={entries}
      engagementTotals={engagementTotals}
      capacityCentiemes={100}
      capacityMode="BLOCAGE"
      onSave={vi.fn(async () => true)}
      {...overrides}
    />,
  )
}

function cell(label: string, date: string): HTMLInputElement {
  return screen.getByLabelText(`${label} ${date}`) as HTMLInputElement
}

describe('MonthGrid', () => {
  afterEach(cleanup)

  it('affiche une ligne par ligne de prestation', () => {
    renderGrid()
    expect(screen.getByText('Consultant ITSM')).toBeDefined()
    expect(screen.getByText('Consultant ITSM Nuit')).toBeDefined()
  })

  it('affiche 31 colonnes de jours en mars', () => {
    renderGrid()
    expect(screen.getAllByRole('columnheader')).toHaveLength(32) // 31 jours + colonne de libellé
  })

  it('formate chaque cellule dans l unité de sa ligne', () => {
    renderGrid()
    expect(screen.getByDisplayValue('1')).toBeDefined() // ligne au jour
    expect(screen.getByDisplayValue('4h')).toBeDefined() // ligne à l heure
  })

  it('marque les jours non ouvrés', () => {
    renderGrid()
    // 2026-03-01 est un dimanche
    const header = screen.getByTestId('day-header-2026-03-01')
    expect(header.className).toContain('bg-off')
    expect(header.getAttribute('data-jour')).toBe('weekend')
  })

  it('signale le dépassement de capacité sur la ligne de totaux', () => {
    renderGrid()
    // 480 + 240 = 720 min à 480 min/jour, soit 150 centièmes > 100
    const total = screen.getByTestId('total-2026-03-12')
    expect(total.className).toContain('text-danger-ink')
    expect(total.getAttribute('data-depassement')).toBe('true')
  })

  // La grille jugeait le dépassement sans connaître le mode : en `DESACTIVE`,
  // elle posait un « ! » que le service ne pose jamais. Le mode doit descendre
  // jusqu'à la ligne de totaux, sans quoi cette même journée porte deux
  // verdicts contradictoires sur le même écran.
  it('fait descendre le mode de capacité jusqu à la ligne de totaux', () => {
    renderGrid({ capacityMode: 'DESACTIVE' })
    const total = screen.getByTestId('total-2026-03-12')
    expect(total.getAttribute('data-depassement')).toBe('false')
    expect(total.className).not.toContain('text-danger-ink')
  })

  // Six états sur une même cellule, et aucun porté par la seule couleur.
  describe('états de la cellule, distinguables sans la couleur', () => {
    const joursAvecFerie = buildMonthDays('2026-03', [1, 2, 3, 4, 5], ['2026-03-02'])

    it('distingue ouvré, week-end et férié par un attribut et un motif', () => {
      renderGrid({ days: joursAvecFerie })

      const ouvre = screen.getByTestId('day-header-2026-03-03')
      const weekend = screen.getByTestId('day-header-2026-03-01')
      const ferie = screen.getByTestId('day-header-2026-03-02')

      expect(ouvre.getAttribute('data-jour')).toBe('ouvre')
      expect(weekend.getAttribute('data-jour')).toBe('weekend')
      expect(ferie.getAttribute('data-jour')).toBe('ferie')

      // Le férié garde son motif : dix jours par an, une information plus
      // forte. Le week-end, lui, se distingue par sa seule clarté — huit jours
      // par mois hachurés étaient le signal d'ancienneté le plus fort du
      // dessin, et l'écart de clarté entre `surface` et `off` porte déjà
      // l'information, sous la garde de `MIN_LIGHTNESS_GAP`.
      expect(ouvre.className).not.toMatch(/pattern-/)
      expect(weekend.className).not.toMatch(/pattern-/)
      expect(weekend.className).toContain('bg-off')
      expect(ferie.className).toContain('pattern-dots')
    })

    it('nomme le férié et le week-end par une légende visible', () => {
      // Le `title` posé sur le `<th>` n'existe qu'au survol de la souris : il
      // ne peut pas être ce qui « nomme » un état de jour. La légende, si.
      renderGrid({ days: joursAvecFerie })
      const legende = screen.getByTestId('legende-jours')
      expect(legende.textContent).toContain('Jour férié')
      expect(legende.textContent).toContain('Jour non ouvré')

      // Et ses pastilles reprennent l'habillage exact des colonnes.
      const pastilles = legende.querySelectorAll('[aria-hidden="true"]')
      expect(pastilles).toHaveLength(2)
      expect(pastilles[1]!.className).toContain('bg-off-strong pattern-dots')
      expect(screen.getByTestId('day-header-2026-03-02').className).toContain(
        'bg-off-strong pattern-dots',
      )
    })

    it('distingue réalisé, prévisionnel et vide sur la saisie', () => {
      renderGrid({
        entries: [
          { id: 'r', lineId: 'l1', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '', ...BORNES, minutesParJour: 480 },
          { id: 'p', lineId: 'l1', date: '2026-03-13', minutes: 480, kind: 'PREVISIONNEL', slotId: '', ...BORNES, minutesParJour: 480 },
        ],
      })

      const realise = cell('Consultant ITSM', '2026-03-12')
      const prevu = cell('Consultant ITSM', '2026-03-13')
      const vide = cell('Consultant ITSM', '2026-03-16')

      expect(realise.getAttribute('data-saisie')).toBe('realise')
      expect(prevu.getAttribute('data-saisie')).toBe('previsionnel')
      expect(vide.getAttribute('data-saisie')).toBe('vide')

      // Contour tireté et italique : le prévisionnel se lit en vision
      // monochrome — la hachure a laissé la place au tireté du calendrier.
      expect(prevu.className).toContain('border-dashed')
      expect(prevu.className).toContain('italic')
      expect(realise.className).not.toContain('border-dashed')
    })

    // I3 — le calendrier et le tableau déduisaient le prévisionnel de deux
    // façons opposées. La règle unique vit maintenant dans
    // `core/saisie/kind.ts` : le prévisionnel l'emporte, des deux côtés.
    it('lit une journée mêlant réalisé et prévisionnel comme prévisionnelle', () => {
      renderGrid({
        entries: [
          { id: 'm', lineId: 'l1', date: '2026-03-17', minutes: 240, kind: 'REALISE', slotId: 'matin', ...BORNES, minutesParJour: 480 },
          { id: 'a', lineId: 'l1', date: '2026-03-17', minutes: 240, kind: 'PREVISIONNEL', slotId: 'apres-midi', ...BORNES, minutesParJour: 480 },
        ],
      })

      const mixte = cell('Consultant ITSM', '2026-03-17')
      expect(mixte.getAttribute('data-saisie')).toBe('previsionnel')
      expect(mixte.className).toContain('border-dashed')
    })

    it('ne dépend pas de l ordre des saisies pour lire une journée mixte', () => {
      renderGrid({
        entries: [
          { id: 'a', lineId: 'l1', date: '2026-03-17', minutes: 240, kind: 'PREVISIONNEL', slotId: 'apres-midi', ...BORNES, minutesParJour: 480 },
          { id: 'm', lineId: 'l1', date: '2026-03-17', minutes: 240, kind: 'REALISE', slotId: 'matin', ...BORNES, minutesParJour: 480 },
        ],
      })

      expect(cell('Consultant ITSM', '2026-03-17').getAttribute('data-saisie')).toBe('previsionnel')
    })

    // Chaque saisie porte le facteur figé à son écriture : convertir la somme
    // des minutes avec le facteur de la ligne donnerait un autre nombre — et
    // un autre nombre que celui du calendrier pour la même journée.
    it('convertit chaque saisie sous son propre facteur, jamais la somme', () => {
      renderGrid({
        entries: [
          { id: 'court', lineId: 'l1', date: '2026-03-18', minutes: 105, kind: 'REALISE', slotId: 'matin', ...BORNES, minutesParJour: 420 },
          { id: 'long', lineId: 'l1', date: '2026-03-18', minutes: 240, kind: 'REALISE', slotId: 'apres-midi', ...BORNES, minutesParJour: 480 },
        ],
      })

      // 105/420 = 0,25 j et 240/480 = 0,50 j, soit 0,75 j.
      // La somme convertie au facteur de la ligne donnerait 345/480 = 0,72 j.
      expect(cell('Consultant ITSM', '2026-03-18').value).toBe('0,75')
    })

    it('offre des cellules de 44 points', () => {
      renderGrid()
      expect(cell('Consultant ITSM', '2026-03-12').className).toContain('touch-target')
    })

    it('ne supprime pas l anneau de focus', () => {
      renderGrid()
      // `outline-none` sans remplacement rendrait la grille inutilisable au clavier.
      expect(cell('Consultant ITSM', '2026-03-12').className).not.toContain('outline-none')
    })

    // I4 — l'input occupe exactement toute la cellule (w-11 + touch-target, et
    // le `<td>` n'a aucun rembourrage). Tout fond opaque posé sur lui recouvre
    // le fond ET le motif du `<td>`, c'est-à-dire l'état du jour.
    it('ne recouvre jamais l état du jour d un fond opaque', () => {
      renderGrid({ days: joursAvecFerie })
      for (const champ of screen.getAllByLabelText(/^Consultant ITSM 2026-03-/)) {
        // Aucune classe de fond, dans aucun état (`focus:bg-off` compris), sauf
        // la transparence qui laisse voir la cellule.
        expect(champ.className.split(/\s+/).filter((c) => /(^|:)bg-/.test(c))).toEqual([
          'bg-transparent',
        ])
      }
    })

    it('laisse le férié pris au focus se distinguer encore du week-end', () => {
      renderGrid({ days: joursAvecFerie })
      const ferie = cell('Consultant ITSM', '2026-03-02').closest('td')!
      const weekend = cell('Consultant ITSM', '2026-03-01').closest('td')!

      // 2026-03-02 est férié dans ce jeu, 2026-03-01 est un dimanche : leurs
      // fonds diffèrent, le férié garde son motif, et rien dans la cellule ne
      // les efface au focus.
      expect(ferie.className).toContain('pattern-dots')
      expect(weekend.className).toContain('bg-off')
      expect(weekend.className).not.toMatch(/pattern-/)
      expect(cell('Consultant ITSM', '2026-03-02').className).not.toMatch(/(^|:)bg-off/)
    })
  })

  it('affiche le bandeau d engagement par ligne', () => {
    renderGrid()
    expect(screen.getByTestId('engagement-l1').textContent).toContain('30')
    expect(screen.getByTestId('engagement-l1').textContent).toContain('29')
  })

  // C3 — le bandeau d'engagement porte sur toute la durée de la ligne. Ouvrir
  // un mois vierge après un mois consommé ne remet pas le compteur à neuf.
  it('alimente le bandeau avec le cumul toutes périodes, pas les saisies du mois affiché', () => {
    renderGrid({
      entries: [],
      engagementTotals: {
        l1: [{ kind: 'REALISE', minutes: 480 * 18, minutesParJour: 480 }],
        l2: [],
      },
    })
    const bandeau = screen.getByTestId('engagement-l1').textContent ?? ''
    expect(bandeau).toContain('18 réalisés')
    expect(bandeau).toContain('12 restants')
  })

  // I2 — le total agrège toutes les lignes. Chaque saisie s'y convertit sous
  // le facteur figé à son écriture : ni celui de la première ligne affichée,
  // ni le réglage global du moment.
  describe('ligne de totaux', () => {
    const journeeCourte: LineForGrid = { ...lines[0]!, minutesParJour: 432 }
    const journeeStandard: LineForGrid = { ...lines[1]!, displayUnit: 'JOUR', minutesParJour: 480 }
    // Une journée pleine écrite sous un réglage à 7 h 12 : 432 minutes valent
    // 1 j, jamais 0,9 j — ce que donnerait le facteur global de 8 h.
    const uneJourneeSurL1: MonthEntry[] = [
      { id: 'e1', lineId: 'l1', date: '2026-03-12', minutes: 432, kind: 'REALISE', slotId: '', ...BORNES, minutesParJour: 432 },
    ]

    it('formate chaque saisie au facteur figé à son écriture', () => {
      renderGrid({ lines: [journeeCourte, journeeStandard], entries: uneJourneeSurL1 })
      expect(screen.getByTestId('total-2026-03-12').textContent).toBe('1')
    })

    it('donne le même total quel que soit l ordre d affichage des lignes', () => {
      renderGrid({ lines: [journeeCourte, journeeStandard], entries: uneJourneeSurL1 })
      const premier = screen.getByTestId('total-2026-03-12').textContent
      cleanup()

      renderGrid({ lines: [journeeStandard, journeeCourte], entries: uneJourneeSurL1 })
      expect(screen.getByTestId('total-2026-03-12').textContent).toBe(premier)
    })
  })

  // I3 — une saisie refusée ne doit pas rester affichée comme si elle avait
  // été enregistrée.
  describe('cellules contrôlées', () => {
    it('restaure la valeur serveur quand l enregistrement est refusé', async () => {
      renderGrid({ onSave: vi.fn(async () => false) })
      const input = cell('Consultant ITSM', '2026-03-13')

      fireEvent.change(input, { target: { value: '0,5' } })
      fireEvent.blur(input)

      await waitFor(() => expect(input.value).toBe(''))
    })

    it('restaure la valeur précédente quand la correction d une cellule est refusée', async () => {
      renderGrid({ onSave: vi.fn(async () => false) })
      const input = cell('Consultant ITSM', '2026-03-12')
      expect(input.value).toBe('1')

      fireEvent.change(input, { target: { value: '2' } })
      fireEvent.blur(input)

      await waitFor(() => expect(input.value).toBe('1'))
    })

    it('conserve la valeur saisie quand l enregistrement est accepté', async () => {
      renderGrid({ onSave: vi.fn(async () => true) })
      const input = cell('Consultant ITSM', '2026-03-13')

      fireEvent.change(input, { target: { value: '0,5' } })
      fireEvent.blur(input)

      await waitFor(() => expect(input.value).toBe('0,5'))
    })

    it('reprend la valeur serveur quand les saisies du mois changent', () => {
      const { rerender } = renderGrid()
      expect(cell('Consultant ITSM', '2026-03-12').value).toBe('1')

      rerender(
        <MonthGrid
          days={days}
          lines={lines}
          entries={[
            { id: 'e1', lineId: 'l1', date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: '', ...BORNES, minutesParJour: 480 },
          ]}
          engagementTotals={engagementTotals}
          capacityCentiemes={100}
          capacityMode="BLOCAGE"
          onSave={vi.fn(async () => true)}
        />,
      )
      expect(cell('Consultant ITSM', '2026-03-12').value).toBe('0,5')
    })

    it('ne vide pas sous les doigts la cellule en cours de frappe', () => {
      const { rerender } = renderGrid()
      const enCours = cell('Consultant ITSM', '2026-03-13')
      fireEvent.focus(enCours)
      fireEvent.change(enCours, { target: { value: '0,7' } })

      // Rafraîchissement serveur provoqué par l'enregistrement d'une autre cellule.
      rerender(
        <MonthGrid
          days={days}
          lines={lines}
          entries={[...entries]}
          engagementTotals={engagementTotals}
          capacityCentiemes={100}
          capacityMode="BLOCAGE"
          onSave={vi.fn(async () => true)}
        />,
      )
      expect(cell('Consultant ITSM', '2026-03-13').value).toBe('0,7')
    })

    it('affiche la valeur sur toute la sélection remplie par glissement', async () => {
      const onSave = vi.fn(async () => true)
      renderGrid({ onSave })

      const depart = cell('Consultant ITSM', '2026-03-09')
      fireEvent.mouseDown(depart.closest('td')!)
      fireEvent.mouseEnter(cell('Consultant ITSM', '2026-03-10').closest('td')!)
      fireEvent.mouseEnter(cell('Consultant ITSM', '2026-03-11').closest('td')!)
      fireEvent.mouseUp(cell('Consultant ITSM', '2026-03-11').closest('td')!)

      fireEvent.change(depart, { target: { value: '1' } })
      fireEvent.keyDown(depart, { key: 'Enter' })

      await waitFor(() => {
        expect(cell('Consultant ITSM', '2026-03-10').value).toBe('1')
        expect(cell('Consultant ITSM', '2026-03-11').value).toBe('1')
      })
      expect(onSave).toHaveBeenCalledTimes(3)
    })
  })

  // I4 — le schéma distingue les créneaux ; la grille doit être cohérente avec
  // son modèle de données plutôt que d'en masquer un.
  describe('journée éclatée en créneaux', () => {
    const deuxCreneaux: MonthEntry[] = [
      { id: 'e1', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'matin', ...BORNES, minutesParJour: 480 },
      { id: 'e2', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'apres-midi', ...BORNES, minutesParJour: 480 },
    ]

    it('additionne les créneaux d une même journée au lieu d en masquer un', () => {
      renderGrid({ entries: deuxCreneaux })
      expect(cell('Consultant ITSM', '2026-03-16').value).toBe('1')
    })

    it('accorde la cellule et la ligne de totaux', () => {
      renderGrid({ entries: deuxCreneaux })
      expect(cell('Consultant ITSM', '2026-03-16').value).toBe(
        screen.getByTestId('total-2026-03-16').textContent,
      )
    })

    it('rend la cellule non modifiable et le signale', async () => {
      const onSave = vi.fn(async () => true)
      renderGrid({ entries: deuxCreneaux, onSave })
      const input = cell('Consultant ITSM', '2026-03-16')

      expect(input.readOnly).toBe(true)
      expect(input.title).not.toBe('')

      fireEvent.change(input, { target: { value: '2' } })
      fireEvent.blur(input)

      await waitFor(() => expect(input.value).toBe('1'))
      expect(onSave).not.toHaveBeenCalled()
    })

    // I4 — le signal « par créneaux » était un fond opaque permanent, qui
    // effaçait l'état du jour sur toutes les journées concernées.
    it('signale les créneaux par un liseré, pas par un fond qui masque la cellule', () => {
      renderGrid({ entries: deuxCreneaux })
      const input = cell('Consultant ITSM', '2026-03-16')

      expect(input.className).not.toContain('bg-warning')
      expect(input.className).toContain('ring-warning-edge')
      // Le `<td>` garde son état de jour : le 16 mars 2026 est un lundi ouvré.
      expect(input.closest('td')!.className).toContain('bg-surface')
    })
  })

  // L'occupation de l'agenda est une information, jamais un blocage : elle se
  // marque comme le week-end et le férié se grisent.
  describe('occupation de l agenda', () => {
    it('marque l en-tête d un jour occupé', () => {
      renderGrid({ busyDates: ['2026-03-12'] })

      const occupe = screen.getByTestId('day-header-2026-03-12')
      expect(occupe.getAttribute('data-busy')).toBe('true')
      expect(occupe.getAttribute('title')).toBe('Occupation dans votre agenda')
    })

    it('ne marque pas les autres jours', () => {
      renderGrid({ busyDates: ['2026-03-12'] })
      expect(screen.getByTestId('day-header-2026-03-13').getAttribute('data-busy')).toBeNull()
    })

    it('ne marque rien quand l agenda est injoignable', () => {
      // Liste vide : c'est exactement ce que `getBusyDays` rend en cas de panne.
      renderGrid({ busyDates: [] })
      expect(screen.getByTestId('day-header-2026-03-12').getAttribute('data-busy')).toBeNull()
    })

    it('ne marque rien quand la page ne transmet aucune occupation', () => {
      renderGrid()
      expect(screen.getByTestId('day-header-2026-03-12').getAttribute('data-busy')).toBeNull()
      expect(screen.getByTestId('day-header-2026-03-12').getAttribute('title')).toBeNull()
    })

    it('laisse la cellule d un jour occupé pleinement saisissable', async () => {
      const onSave = vi.fn(async () => true)
      renderGrid({ busyDates: ['2026-03-13'], onSave })
      const input = cell('Consultant ITSM', '2026-03-13')
      expect(input.readOnly).toBe(false)

      fireEvent.change(input, { target: { value: '0,5' } })
      fireEvent.blur(input)

      // Marquer n'est pas bloquer : la valeur part au serveur et reste à l'écran.
      // Le créneau est le quatrième paramètre depuis la tâche 12 : vide, c'est
      // la journée entière, et c'est le défaut.
      await waitFor(() => expect(onSave).toHaveBeenCalledWith('l1', '2026-03-13', '0,5', ''))
      expect(input.value).toBe('0,5')
    })

    // Le marquage est une couche de plus, pas un remplacement : un dimanche
    // occupé reste un dimanche.
    it('n efface pas l état du jour qu il marque', () => {
      // 2026-03-01 est un dimanche.
      renderGrid({ busyDates: ['2026-03-01'] })
      const occupe = screen.getByTestId('day-header-2026-03-01')

      expect(occupe.getAttribute('data-jour')).toBe('weekend')
      expect(occupe.className).toContain('bg-off')
      expect(occupe.getAttribute('title')).toBe('Jour non ouvré — Occupation dans votre agenda')
    })

    // Aucune information portée par la seule couleur : le `title` n'existe qu'à
    // la souris, et un liseré ne se voit pas d'un lecteur d'écran.
    it('porte l occupation autrement que par la teinte', () => {
      renderGrid({ busyDates: ['2026-03-12'] })
      const occupe = screen.getByTestId('day-header-2026-03-12')
      const libre = screen.getByTestId('day-header-2026-03-13')

      // Un liseré : une différence de forme, lisible en vision monochrome.
      expect(occupe.className).toContain('border-b-2')
      expect(libre.className).not.toContain('border-b-2')

      // Et un texte, pour qui ne voit pas la colonne du tout.
      const cache = occupe.querySelector('.sr-only')
      expect(cache).not.toBeNull()
      expect(cache!.textContent).toContain('Occupation dans votre agenda')
    })

    it('nomme l occupation par une légende visible, seulement quand elle existe', () => {
      renderGrid({ busyDates: ['2026-03-12'] })
      expect(screen.getByTestId('legende-jours').textContent).toContain(
        'Occupation dans votre agenda',
      )

      cleanup()
      renderGrid()
      expect(screen.getByTestId('legende-jours').textContent).not.toContain('Occupation')
    })
  })

  describe('saisie par créneau', () => {
    it('ne montre aucun sélecteur quand aucun créneau n est configuré', () => {
      renderGrid()
      expect(screen.queryByLabelText('Créneau — Consultant ITSM')).toBeNull()
    })

    it('propose la journée par défaut, puis les créneaux', () => {
      renderGrid({ slots: DEFAULT_SLOTS })
      const select = screen.getByLabelText('Créneau — Consultant ITSM') as HTMLSelectElement

      expect(select.value).toBe('')
      expect([...select.options].map((o) => o.textContent)).toEqual([
        'Journée',
        'Matin',
        'Après-midi',
        'Nuit',
      ])
    })

    it('enregistre sur le créneau choisi', async () => {
      const onSave = vi.fn(async () => true)
      renderGrid({ slots: DEFAULT_SLOTS, onSave })

      fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM'), {
        target: { value: 'matin' },
      })
      const input = cell('Consultant ITSM', '2026-03-13')
      fireEvent.change(input, { target: { value: '0,5' } })
      fireEvent.blur(input)

      await waitFor(() =>
        expect(onSave).toHaveBeenCalledWith('l1', '2026-03-13', '0,5', 'matin'),
      )
    })

    it('rend éditable une cellule agrégée dès qu un créneau est choisi', () => {
      // Ligne l2 : sa cellule du 12 agrège un créneau, donc verrouillée en vue
      // journée — mais éditable dès qu'on se place sur le créneau lui-même.
      renderGrid({ slots: DEFAULT_SLOTS })
      expect(cell('Consultant ITSM Nuit', '2026-03-12').readOnly).toBe(true)

      fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM Nuit'), {
        target: { value: 'nuit' },
      })
      expect(cell('Consultant ITSM Nuit', '2026-03-12').readOnly).toBe(false)
    })

    // `readOnly` et le garde-fou de l'enregistrement sont deux choses : une
    // cellule redevenue modifiable dont l'écriture serait encore court-circuitée
    // rendrait la saisie par créneau muette, sans qu'aucun état visible ne
    // change.
    it('enregistre réellement sur une journée déjà éclatée en créneaux', async () => {
      const onSave = vi.fn(async () => true)
      renderGrid({ slots: DEFAULT_SLOTS, onSave })

      fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM Nuit'), {
        target: { value: 'nuit' },
      })
      const input = cell('Consultant ITSM Nuit', '2026-03-12')
      fireEvent.change(input, { target: { value: '6h' } })
      fireEvent.blur(input)

      await waitFor(() => expect(onSave).toHaveBeenCalledWith('l2', '2026-03-12', '6h', 'nuit'))
      expect(input.value).toBe('6h')
    })

    // La cellule vise la saisie du créneau choisi, pas le total de la journée :
    // afficher l'agrégat sur un créneau ferait écraser une demi-journée par le
    // total des deux à la première correction.
    it('montre la valeur du créneau choisi, jamais le total de la journée', () => {
      renderGrid({
        slots: DEFAULT_SLOTS,
        entries: [
          { id: 'm', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'matin', ...BORNES, minutesParJour: 480 },
          { id: 'a', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'apres-midi', ...BORNES, minutesParJour: 480 },
        ],
      })
      expect(cell('Consultant ITSM', '2026-03-16').value).toBe('1')

      fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM'), {
        target: { value: 'matin' },
      })
      expect(cell('Consultant ITSM', '2026-03-16').value).toBe('0,5')
    })

    it('laisse vide la cellule d un créneau que la journée ne porte pas', () => {
      renderGrid({ slots: DEFAULT_SLOTS })
      // Le 12 porte une saisie « nuit » sur l2, et rien sur « matin ».
      expect(cell('Consultant ITSM Nuit', '2026-03-12').value).toBe('4h')

      fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM Nuit'), {
        target: { value: 'matin' },
      })
      expect(cell('Consultant ITSM Nuit', '2026-03-12').value).toBe('')
    })

    // `kindDeLaJournee` tranche pour la journée entière ; sur un créneau, c'est
    // la nature de *cette* saisie qui se lit, sans quoi une demi-journée
    // réalisée s'afficherait prévisionnelle parce que l'autre moitié l'est.
    it('lit la nature du créneau choisi, pas celle de la journée mêlée', () => {
      renderGrid({
        slots: DEFAULT_SLOTS,
        entries: [
          { id: 'm', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'matin', ...BORNES, minutesParJour: 480 },
          { id: 'a', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'PREVISIONNEL', slotId: 'apres-midi', ...BORNES, minutesParJour: 480 },
        ],
      })
      expect(cell('Consultant ITSM', '2026-03-16').getAttribute('data-saisie')).toBe(
        'previsionnel',
      )

      fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM'), {
        target: { value: 'matin' },
      })
      expect(cell('Consultant ITSM', '2026-03-16').getAttribute('data-saisie')).toBe('realise')
    })

    it('ne change le créneau que de sa propre ligne', () => {
      renderGrid({ slots: DEFAULT_SLOTS })
      fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM'), {
        target: { value: 'matin' },
      })

      const autre = screen.getByLabelText('Créneau — Consultant ITSM Nuit') as HTMLSelectElement
      expect(autre.value).toBe('')
      expect(cell('Consultant ITSM Nuit', '2026-03-12').readOnly).toBe(true)
    })

    it('offre une cible tactile sur le sélecteur de créneau', () => {
      renderGrid({ slots: DEFAULT_SLOTS })
      expect(screen.getByLabelText('Créneau — Consultant ITSM').className).toContain(
        'touch-target',
      )
    })

    it('laisse la saisie rapide au glissement inchangée', async () => {
      const onSave = vi.fn(async () => true)
      renderGrid({ slots: DEFAULT_SLOTS, onSave })

      const debut = cell('Consultant ITSM', '2026-03-16')
      fireEvent.mouseDown(debut.parentElement as HTMLElement)
      fireEvent.mouseEnter(cell('Consultant ITSM', '2026-03-17').parentElement as HTMLElement)
      fireEvent.mouseUp(debut.parentElement as HTMLElement)
      fireEvent.change(debut, { target: { value: '1' } })
      fireEvent.keyDown(debut, { key: 'Enter' })

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
      // Journée par défaut : le geste principal n'est pas modifié.
      expect(onSave).toHaveBeenCalledWith('l1', '2026-03-16', '1', '')
    })

    it('suit le créneau choisi jusque dans la saisie rapide au glissement', async () => {
      const onSave = vi.fn(async () => true)
      renderGrid({ slots: DEFAULT_SLOTS, onSave })

      fireEvent.change(screen.getByLabelText('Créneau — Consultant ITSM'), {
        target: { value: 'apres-midi' },
      })

      const debut = cell('Consultant ITSM', '2026-03-16')
      fireEvent.mouseDown(debut.parentElement as HTMLElement)
      fireEvent.mouseEnter(cell('Consultant ITSM', '2026-03-17').parentElement as HTMLElement)
      fireEvent.mouseUp(debut.parentElement as HTMLElement)
      fireEvent.change(debut, { target: { value: '0,5' } })
      fireEvent.keyDown(debut, { key: 'Enter' })

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
      expect(onSave).toHaveBeenCalledWith('l1', '2026-03-16', '0,5', 'apres-midi')
      expect(onSave).toHaveBeenCalledWith('l1', '2026-03-17', '0,5', 'apres-midi')
    })
  })

  /**
   * Le tableau est la vue **multi-CRA** : celle qui montre toutes les missions
   * et prestations auxquelles on est affecté. C'est donc là que distinguer les
   * lignes sert le plus — et c'est justement là que le code couleur manquait,
   * le calendrier l'ayant reçu seul au lot 1f.
   *
   * La règle est la même des deux côtés, et elle n'est réécrite ni ici ni dans
   * le composant : la teinte vient de `colorForLine`, la forme de
   * `formeDeLaCase`.
   */
  describe('le code couleur, comme au calendrier', () => {
    /** Les classes `text-*` qui ne portent pas d'encre : taille et alignement. */
    const SANS_ENCRE = new Set([
      'text-xs',
      'text-sm',
      'text-base',
      'text-lg',
      'text-xl',
      'text-2xl',
      'text-center',
      'text-left',
      'text-right',
    ])

    function remplissage(lineId: string, date: string): HTMLElement | null {
      return screen.queryByTestId(`remplissage-${lineId}-${date}`)
    }

    /**
     * Les classes une à une, jamais la chaîne entière : `toContain('bg-cat-a')`
     * sur `className` accepterait `bg-cat-a-edge`.
     */
    function classes(el: Element): string[] {
      return el.className.split(/\s+/).filter((c) => c !== '')
    }

    it('pose derrière chaque cellule remplie l aplat de sa prestation', () => {
      renderGrid()
      const aplat = remplissage('l1', '2026-03-12')
      expect(aplat).not.toBeNull()
      expect(classes(aplat!)).toContain(colorForLine('l1').bg)
    })

    // Une couleur par prestation, dérivée du seul identifiant : c'est ce qui
    // permet de suivre une ligne d'un écran à l'autre.
    it('donne à deux prestations deux teintes distinctes', () => {
      renderGrid()
      const premiere = classes(remplissage('l1', '2026-03-12')!).find((c) => c.startsWith('bg-cat-'))
      const seconde = classes(remplissage('l2', '2026-03-12')!).find((c) => c.startsWith('bg-cat-'))
      expect(premiere).toBeDefined()
      expect(seconde).toBeDefined()
      expect(premiere).not.toBe(seconde)
    })

    it('ne pose aucun aplat sur une cellule vide', () => {
      renderGrid()
      expect(remplissage('l1', '2026-03-13')).toBeNull()
    })

    // La quantité se lit à la forme : aplat plein pour une journée, demi-aplat
    // taillé en diagonale pour une demi-journée, hauteur proportionnelle pour
    // une durée libre. Le chiffre reste, il ne porte plus seul la lecture.
    it('remplit toute la cellule pour une journée entière', () => {
      renderGrid()
      const aplat = remplissage('l1', '2026-03-12')!
      expect(aplat.getAttribute('data-forme')).toBe('PLEINE')
      expect(aplat.style.height).toBe('100%')
    })

    it('taille la demi-journée du matin en diagonale, comme le calendrier', () => {
      renderGrid({
        slots: DEFAULT_SLOTS,
        entries: [
          { id: 'm', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'matin', ...BORNES, minutesParJour: 480 },
        ],
      })
      const aplat = remplissage('l1', '2026-03-16')!
      expect(aplat.getAttribute('data-forme')).toBe('MOITIE-AM')
      expect(classes(aplat)).toContain('clip-half-am')
      expect(classes(aplat)).not.toContain('clip-half-pm')
    })

    it('remplit une durée libre proportionnellement, sans effacer le chiffre', () => {
      renderGrid({
        slots: DEFAULT_SLOTS,
        entries: [
          { id: 'l', lineId: 'l1', date: '2026-03-16', minutes: 180, kind: 'REALISE', slotId: 'nuit', ...BORNES, minutesParJour: 480 },
        ],
      })
      const aplat = remplissage('l1', '2026-03-16')!
      expect(aplat.getAttribute('data-forme')).toBe('PARTIELLE')
      // 3 h sur une journée de 8 h : 0,38 j, et 38 % de la cellule.
      expect(aplat.style.height).toBe('38%')
      // Aucun aplat ne dit « trois heures » : le chiffre reste, et il reste
      // dans le champ, pas dans l'aplat.
      const champ = cell('Consultant ITSM', '2026-03-16')
      expect(champ.value).toBe('0,38')
      expect(aplat.contains(champ)).toBe(false)
    })

    // Le piège le plus répété du projet, ici sur une hauteur d'aplat :
    // convertir la somme des minutes sous le facteur courant de la ligne
    // donnerait 360/480 = 75 %.
    it('calcule la hauteur de l aplat à facteur constant', () => {
      renderGrid({
        slots: DEFAULT_SLOTS,
        entries: [
          { id: 'a', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'matin', ...BORNES, minutesParJour: 480 },
          { id: 'b', lineId: 'l1', date: '2026-03-16', minutes: 120, kind: 'REALISE', slotId: 'nuit', ...BORNES, minutesParJour: 420 },
        ],
      })
      // 0,50 + 0,29 = 0,79 — et non 0,75.
      expect(remplissage('l1', '2026-03-16')!.style.height).toBe('79%')
    })

    it('pose l aplat sous le champ, sans intercepter le geste', () => {
      renderGrid()
      const aplat = remplissage('l1', '2026-03-12')!
      expect(aplat.getAttribute('aria-hidden')).toBe('true')
      expect(classes(aplat)).toContain('pointer-events-none')
    })

    // L'angle mort déjà documenté : le contrôle de contraste porte sur des
    // couleurs **opaques**. Une demi-couverture obtenue par une opacité y
    // échapperait entièrement.
    it('n obtient jamais sa moitié par une opacité', () => {
      renderGrid({
        slots: DEFAULT_SLOTS,
        entries: [
          { id: 'm', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'matin', ...BORNES, minutesParJour: 480 },
        ],
      })
      const aplat = remplissage('l1', '2026-03-16')!
      for (const c of classes(aplat)) expect(c).not.toMatch(/^(?:bg|text|border|ring)-.*\/\d+$/)
      expect(aplat.style.opacity).toBe('')
    })

    /**
     * La contrainte que le calendrier n'a pas : les cellules du tableau sont
     * des champs de saisie. Une encre posée par-dessus l'aplat doit tenir le
     * contraste sur la teinte catégorielle, et le seul couple déclaré pour ces
     * fonds est `ink` (`TEXT_PAIRS`, `core/theme/tokens.ts`). `muted` — que le
     * prévisionnel posait — tombe sous 4,5:1 sur les fonds les plus clairs de
     * la palette, et `warning-ink` — que la journée par créneaux pose — aussi.
     */
    it('ne pose aucune encre non déclarée par-dessus l aplat', () => {
      renderGrid({
        slots: DEFAULT_SLOTS,
        entries: [
          { id: 'p', lineId: 'l1', date: '2026-03-13', minutes: 480, kind: 'PREVISIONNEL', slotId: '', ...BORNES, minutesParJour: 480 },
          { id: 'm', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'matin', ...BORNES, minutesParJour: 480 },
          { id: 'a', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'apres-midi', ...BORNES, minutesParJour: 480 },
        ],
      })

      // Le jeu d'essai porte bien les deux cas que la règle vise.
      expect(cell('Consultant ITSM', '2026-03-13').getAttribute('data-saisie')).toBe('previsionnel')
      expect(cell('Consultant ITSM', '2026-03-16').readOnly).toBe(true)

      let couverts = 0
      for (const champ of screen.getAllByLabelText(/^Consultant ITSM 2026-03-/)) {
        if (remplissage('l1', champ.getAttribute('aria-label')!.slice(-10)) === null) continue
        couverts += 1
        // `text-*` porte aussi des tailles et des alignements : ne garder que
        // les encres, sans quoi l'assertion refuserait `text-xs`.
        expect(classes(champ).filter((c) => /^text-/.test(c) && !SANS_ENCRE.has(c))).toEqual([
          'text-ink',
        ])
      }
      // Deux cellules couvertes, et ce sont exactement les deux cas visés :
      // le prévisionnel du 13 et la journée par créneaux du 16.
      expect(couverts).toBe(2)
    })

    // Le prévisionnel garde ce qui le distingue en vision monochrome : le
    // remplacement de l'encre grise par l'encre pleine ne lui retire ni son
    // contour tireté ni son italique.
    it('garde le contour tireté et l italique du prévisionnel sous l aplat', () => {
      renderGrid({
        entries: [
          { id: 'p', lineId: 'l1', date: '2026-03-13', minutes: 480, kind: 'PREVISIONNEL', slotId: '', ...BORNES, minutesParJour: 480 },
        ],
      })
      const champ = cell('Consultant ITSM', '2026-03-13')
      expect(remplissage('l1', '2026-03-13')).not.toBeNull()
      expect(classes(champ)).toContain('border-dashed')
      expect(classes(champ)).toContain('italic')
    })
  })

  /**
   * Le même fait, sur le même écran, dessiné une seule façon.
   *
   * `/saisie/[month]` porte deux vues de la même journée, et l'on bascule de
   * l'une à l'autre sans changer de page. Le lot 1g a donné au calendrier la
   * teinte ambre et le contour tireté du prévisionnel ; le tableau était resté
   * aux hachures du lot 1f. Basculer montrait alors **deux apparences du même
   * fait** — exactement ce que le lot 1f avait corrigé pour le code couleur.
   *
   * Le test rend donc les deux vues sur la même saisie et compare ce qu'elles
   * peignent, plutôt que d'affirmer deux fois la même intention de deux côtés.
   */
  describe('le prévisionnel, le même des deux côtés de la bascule', () => {
    const PREVU: MonthEntry = {
      id: 'p', lineId: 'l1', date: '2026-03-13', minutes: 480, kind: 'PREVISIONNEL',
      slotId: '', ...BORNES, minutesParJour: 480,
    }
    const REALISE: MonthEntry = { ...PREVU, id: 'r', kind: 'REALISE' }

    function classesDe(el: Element): string[] {
      return el.className.split(/\s+/).filter((c) => c !== '')
    }

    function rendreCalendrier(entries: MonthEntry[]): void {
      render(
        <MonthCalendar
          days={days}
          line={lines[0]!}
          slots={DEFAULT_SLOTS}
          entries={entries}
          autresLignes={[]}
          toutLeMois={false}
          onApply={vi.fn(async () => true)}
          onRange={vi.fn(async () => {})}
          onFormulaire={vi.fn()}
        />,
      )
    }

    /** La teinte de l'aplat et le tireté de la case, tels que la vue les rend. */
    interface Rendu {
      teinte: string | undefined
      tirete: boolean
      hachure: boolean
    }

    function auCalendrier(entries: MonthEntry[]): Rendu {
      rendreCalendrier(entries)
      const aplat = screen.queryByTestId('remplissage-2026-03-13')
      const laCase = classesDe(screen.getByTestId('case-2026-03-13'))
      const rendu = {
        teinte: aplat === null ? undefined : classesDe(aplat).find((c) => c.startsWith('bg-')),
        tirete: laCase.includes('border-dashed'),
        hachure: laCase.includes('pattern-hatch'),
      }
      cleanup()
      return rendu
    }

    function auTableau(entries: MonthEntry[]): Rendu {
      renderGrid({ entries })
      const aplat = screen.queryByTestId('remplissage-l1-2026-03-13')
      const champ = classesDe(cell('Consultant ITSM', '2026-03-13'))
      const rendu = {
        teinte: aplat === null ? undefined : classesDe(aplat).find((c) => c.startsWith('bg-')),
        tirete: champ.includes('border-dashed'),
        hachure: champ.includes('pattern-hatch'),
      }
      cleanup()
      return rendu
    }

    it('peint la même teinte et le même contour dans les deux vues', () => {
      const calendrier = auCalendrier([PREVU])
      const tableau = auTableau([PREVU])

      expect(tableau).toEqual(calendrier)
      // Et ce que les deux vues peignent est bien la loi du lot : ambre et
      // tireté, jamais la hachure — sans quoi elles pourraient être d'accord
      // sur autre chose.
      expect(tableau.teinte).toBe(PREVU_COLOR.bg)
      expect(tableau.tirete).toBe(true)
      expect(tableau.hachure).toBe(false)
    })

    it('laisse le réalisé à la teinte de sa prestation, des deux côtés', () => {
      const calendrier = auCalendrier([REALISE])
      const tableau = auTableau([REALISE])

      // Le calendrier est en portée « Cette prestation » : sa teinte de réalisé
      // est `saisie`, celle du tableau est catégorielle — c'est voulu, le
      // tableau montre toutes les lignes. Ce qui doit coïncider, c'est
      // l'**absence** d'ambre et de tireté.
      expect(tableau.teinte).not.toBe(PREVU_COLOR.bg)
      expect(calendrier.teinte).not.toBe(PREVU_COLOR.bg)
      expect(tableau.tirete).toBe(false)
      expect(calendrier.tirete).toBe(false)
    })
  })

  // I5 — le seul lien segment → sens des bandeaux d'engagement était un
  // `title` sur un `<div>` non focalisable : invisible au clavier, invisible
  // au tactile, non annoncé. La grille nomme ses segments visiblement.
  it('nomme visiblement les segments des bandeaux d engagement', () => {
    renderGrid()
    const legende = screen.getByTestId('legende-segments')
    expect(legende.textContent).toContain('Réalisé')
    expect(legende.textContent).toContain('Prévisionnel')
  })
})
