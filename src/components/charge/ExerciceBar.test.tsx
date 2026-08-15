// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ExerciceBar } from './ExerciceBar'

afterEach(cleanup)

const base = {
  objectifCents: 15_000_000,
  realiseCents: 4_000_000,
  prevuCents: 3_000_000,
  resteAVendreCents: 8_000_000,
  depassementCents: 0,
  tauxCouverture: 7 / 15,
}

describe('ExerciceBar', () => {
  it('affiche le libellé de l exercice', () => {
    render(<ExerciceBar label="Exercice 2026-2027" progress={base} resteEnJoursCentiemes={8889} />)
    expect(screen.getByText(/Exercice 2026-2027/)).toBeDefined()
  })

  it('met le reste à vendre en avant, en euros et en jours', () => {
    render(<ExerciceBar label="Exercice 2026-2027" progress={base} resteEnJoursCentiemes={8889} />)
    const reste = screen.getByTestId('reste-a-vendre')
    // `toLocaleString('fr-FR')` sépare les milliers par une espace fine
    // insécable (U+202F), pas par une espace ordinaire : comparer au texte
    // brut produirait un test faux. On neutralise donc toutes les espaces.
    const sansEspaces = reste.textContent!.replace(/\s/g, '')
    expect(sansEspaces).toContain('80000')
    expect(sansEspaces).toContain('88,89')
  })

  it('masque la conversion en jours sans TJM moyen', () => {
    render(<ExerciceBar label="Exercice 2026-2027" progress={base} resteEnJoursCentiemes={null} />)
    expect(screen.getByTestId('reste-a-vendre').textContent).not.toContain('jours')
  })

  it('ne rend rien quand l objectif n est pas défini', () => {
    const sansObjectif = { ...base, objectifCents: 0, resteAVendreCents: 0, tauxCouverture: 0 }
    const { container } = render(
      <ExerciceBar label="Exercice 2026-2027" progress={sansObjectif} resteEnJoursCentiemes={null} />,
    )
    expect(container.textContent).toBe('')
  })

  it('signale un dépassement d objectif', () => {
    const depasse = { ...base, resteAVendreCents: 0, depassementCents: 2_000_000 }
    render(<ExerciceBar label="Exercice 2026-2027" progress={depasse} resteEnJoursCentiemes={null} />)
    expect(screen.getByText(/dépassé/i)).toBeDefined()
  })
})
