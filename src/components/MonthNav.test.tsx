// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

import { MonthNav, monthLabel } from './MonthNav'

afterEach(() => {
  cleanup()
  push.mockReset()
})

describe('monthLabel', () => {
  it('affiche le mois en toutes lettres, en français', () => {
    expect(monthLabel('2026-08')).toBe('août 2026')
  })
})

describe('MonthNav', () => {
  it('affiche le mois courant en toutes lettres', () => {
    render(<MonthNav month="2026-08" />)
    expect(screen.getByText('août 2026')).toBeDefined()
  })

  it('pointe les flèches vers le mois précédent et le mois suivant', () => {
    render(<MonthNav month="2026-08" />)
    expect(screen.getByLabelText('Mois précédent').getAttribute('href')).toBe('/saisie/2026-07')
    expect(screen.getByLabelText('Mois suivant').getAttribute('href')).toBe('/saisie/2026-09')
  })

  // Constat revue C.4 — la spec §6 exige un sélecteur direct de mois en plus
  // des flèches et du retour au mois courant : sans lui, atteindre un mois
  // distant demande autant de clics que de mois d'écart.
  it('propose un sélecteur direct de mois', () => {
    render(<MonthNav month="2026-08" />)
    const input = screen.getByLabelText(/aller directement à un mois/i) as HTMLInputElement
    expect(input.type).toBe('month')
    expect(input.value).toBe('2026-08')
  })

  it('navigue vers le mois choisi dans le sélecteur direct', () => {
    render(<MonthNav month="2026-08" />)
    const input = screen.getByLabelText(/aller directement à un mois/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '2027-03' } })
    expect(push).toHaveBeenCalledWith('/saisie/2027-03')
  })

  it('masque le lien « Mois courant » quand on y est déjà', () => {
    const today = new Date().toISOString().slice(0, 7)
    render(<MonthNav month={today} />)
    expect(screen.queryByText('Mois courant')).toBeNull()
  })

  it('affiche le lien « Mois courant » sur un autre mois', () => {
    render(<MonthNav month="2020-01" />)
    expect(screen.getByText('Mois courant')).toBeDefined()
  })
})
