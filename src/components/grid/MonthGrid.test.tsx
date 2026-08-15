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
      capacityMinutes={480}
      minutesParJour={480}
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
    expect(header.className).toContain('bg-slate-100')
  })

  it('signale le dépassement de capacité sur la ligne de totaux', () => {
    renderGrid()
    // 480 + 240 = 720 > 480
    const total = screen.getByTestId('total-2026-03-12')
    expect(total.className).toContain('text-red-600')
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

  // I2 — le total agrège toutes les lignes : il s'exprime dans l'unité de
  // référence globale, jamais dans celle de la première ligne de la grille.
  describe('ligne de totaux', () => {
    const journeeCourte: LineForGrid = { ...lines[0]!, minutesParJour: 432 }
    const journeeStandard: LineForGrid = { ...lines[1]!, displayUnit: 'JOUR', minutesParJour: 480 }
    const uneJourneeSurL2: MonthEntry[] = [
      { id: 'e1', lineId: 'l2', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '', minutesParJour: 480 },
    ]

    it('formate avec le minutesParJour global, pas celui de la première ligne', () => {
      renderGrid({ lines: [journeeCourte, journeeStandard], entries: uneJourneeSurL2 })
      expect(screen.getByTestId('total-2026-03-12').textContent).toBe('1')
    })

    it('donne le même total quel que soit l ordre d affichage des lignes', () => {
      renderGrid({ lines: [journeeCourte, journeeStandard], entries: uneJourneeSurL2 })
      const premier = screen.getByTestId('total-2026-03-12').textContent
      cleanup()

      renderGrid({ lines: [journeeStandard, journeeCourte], entries: uneJourneeSurL2 })
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
          capacityMinutes={480}
          minutesParJour={480}
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
          capacityMinutes={480}
          minutesParJour={480}
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
  })
})
