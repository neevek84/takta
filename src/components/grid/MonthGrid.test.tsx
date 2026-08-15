// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MonthGrid } from './MonthGrid'
import { buildMonthDays } from '@/core/month/build'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'

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

const entries: MonthEntry[] = [
  { id: 'e1', lineId: 'l1', date: '2026-03-12', minutes: 480, kind: 'REALISE', slotId: '' },
  { id: 'e2', lineId: 'l2', date: '2026-03-12', minutes: 240, kind: 'REALISE', slotId: 'nuit' },
]

function renderGrid() {
  return render(
    <MonthGrid
      days={days}
      lines={lines}
      entries={entries}
      capacityMinutes={480}
      onSave={vi.fn()}
    />,
  )
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
})
