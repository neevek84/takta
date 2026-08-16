// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MonthGrid } from './MonthGrid'
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

// `minutesParJour` est figé sur chaque saisie depuis le lot 1d : les deux
// lignes du jeu d'essai travaillent en journées de 8 h.
const entries: MonthEntry[] = [
  { id: 'e1', lineId: 'l1', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '', minutesParJour: 480 },
  { id: 'e2', lineId: 'l2', date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'nuit', minutesParJour: 480 },
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

      // Le motif porte l'information là où la teinte ne suffit pas.
      expect(ouvre.className).not.toMatch(/pattern-/)
      expect(weekend.className).toContain('pattern-stripes')
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
          { id: 'r', lineId: 'l1', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '', minutesParJour: 480 },
          { id: 'p', lineId: 'l1', date: '2026-03-13', minutes: 480, kind: 'PREVISIONNEL', slotId: '', minutesParJour: 480 },
        ],
      })

      const realise = cell('Consultant ITSM', '2026-03-12')
      const prevu = cell('Consultant ITSM', '2026-03-13')
      const vide = cell('Consultant ITSM', '2026-03-16')

      expect(realise.getAttribute('data-saisie')).toBe('realise')
      expect(prevu.getAttribute('data-saisie')).toBe('previsionnel')
      expect(vide.getAttribute('data-saisie')).toBe('vide')

      // Hachures et italique : le prévisionnel se lit en vision monochrome.
      expect(prevu.className).toContain('pattern-hatch')
      expect(prevu.className).toContain('italic')
      expect(realise.className).not.toContain('pattern-hatch')
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
      // motifs diffèrent, et rien dans la cellule ne les efface au focus.
      expect(ferie.className).toContain('pattern-dots')
      expect(weekend.className).toContain('pattern-stripes')
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
      { id: 'e1', lineId: 'l1', date: '2026-03-12', minutes: 432, kind: 'REALISE', slotId: '', minutesParJour: 432 },
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
            { id: 'e1', lineId: 'l1', date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: '', minutesParJour: 480 },
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
      { id: 'e1', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'matin', minutesParJour: 480 },
      { id: 'e2', lineId: 'l1', date: '2026-03-16', minutes: 240, kind: 'REALISE', slotId: 'apres-midi', minutesParJour: 480 },
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
