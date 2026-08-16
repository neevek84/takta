// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { MonthEntry } from '@/services/time-entries'

const { validerJoursPasses } = vi.hoisted(() => ({ validerJoursPasses: vi.fn() }))
vi.mock('./actions', () => ({ validerJoursPasses }))

// `vi.mock` est hissé au-dessus des imports : le server action n'est jamais
// chargé, seul le composant l'est.
import { PastForecastNotice } from './PastForecastNotice'

function entry(id: string, date: string): MonthEntry {
  // Le facteur est figé sur la saisie depuis le lot 1d ; l'encart ne s'en sert
  // pas, mais le type l'exige — les journées du jeu d'essai font 8 h.
  return { id, lineId: 'l1', date, minutes: 480, kind: 'PREVISIONNEL', slotId: '', startMinute: 540, endMinute: 1020, minutesParJour: 480 }
}

beforeEach(() => {
  validerJoursPasses.mockReset()
})
afterEach(cleanup)

describe('PastForecastNotice', () => {
  it('ne rend rien sans prévisionnel échu', () => {
    const { container } = render(<PastForecastNotice month="2026-03" entries={[]} lockedCount={0} />)
    expect(container.textContent).toBe('')
  })

  it('annonce les jours convertibles, verrouillés exclus', () => {
    render(
      <PastForecastNotice
        month="2026-03"
        entries={[entry('a', '2026-03-10'), entry('b', '2026-03-11'), entry('c', '2026-03-12')]}
        lockedCount={1}
      />,
    )
    expect(screen.getByRole('button').textContent).toBe('Valider ces 2 jours')
  })

  // Le défaut : l'action jetait `{ converted, skippedLocked }`, rien ne
  // remontait à l'écran. Un écart entre l'annonce et le résultat doit se voir.
  it('affiche le compte rendu de la conversion, écart compris', async () => {
    validerJoursPasses.mockResolvedValue({ converted: 1, skippedLocked: 1 })

    render(
      <PastForecastNotice
        month="2026-03"
        entries={[entry('a', '2026-03-10'), entry('b', '2026-03-11')]}
        lockedCount={0}
      />,
    )
    fireEvent.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe(
        "1 jour converti en réalisé. 1 jour n'a pas pu l'être : le CRA de leur mission est validé.",
      )
    })
  })

  it('garde le compte rendu quand il ne reste plus aucun jour échu', async () => {
    validerJoursPasses.mockResolvedValue({ converted: 2, skippedLocked: 0 })

    const { rerender } = render(
      <PastForecastNotice
        month="2026-03"
        entries={[entry('a', '2026-03-10'), entry('b', '2026-03-11')]}
        lockedCount={0}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())

    // Après conversion la page se revalide : plus aucun prévisionnel échu.
    rerender(<PastForecastNotice month="2026-03" entries={[]} lockedCount={0} />)
    expect(screen.getByRole('status').textContent).toBe('2 jours convertis en réalisé.')
  })
})
