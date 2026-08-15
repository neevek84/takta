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

  // La barre d'exercice porte la même distinction que le reste : le
  // prévisionnel se hachure, il ne se contente pas d'être plus clair.
  it('distingue le segment prévisionnel du réalisé sans la couleur', () => {
    render(<ExerciceBar label="Exercice 2026-2027" progress={base} resteEnJoursCentiemes={null} />)
    const realise = screen.getByTestId('bar-realise')
    const prevu = screen.getByTestId('bar-prevu')

    expect(prevu.className).toContain('pattern-hatch')
    expect(realise.className).not.toContain('pattern-hatch')
    expect(prevu.getAttribute('title')).toContain('révisionnel')
    expect(realise.getAttribute('title')).toContain('éalisé')
  })

  // Constat revue C.2 — objectif 10 000 €, réalisé 9 000 € (90 %), prévu
  // 3 000 € (30 %) : la somme des deux segments (120 %) ne doit jamais
  // dépasser 100 % de largeur, sous peine de laisser le flexbox comprimer
  // les deux barres et fausser le rapport visuel réalisé/prévu.
  it('ne laisse jamais la somme des segments dépasser 100 % de largeur', () => {
    const depassementPrevisionnel = {
      objectifCents: 1_000_000,
      realiseCents: 900_000,
      prevuCents: 300_000,
      resteAVendreCents: 0,
      depassementCents: 200_000,
      tauxCouverture: 1.2,
    }
    render(
      <ExerciceBar
        label="Exercice 2026-2027"
        progress={depassementPrevisionnel}
        resteEnJoursCentiemes={null}
      />,
    )
    const realise = screen.getByTestId('bar-realise') as HTMLElement
    const prevu = screen.getByTestId('bar-prevu') as HTMLElement
    const realisePct = parseFloat(realise.style.width)
    const prevuPct = parseFloat(prevu.style.width)

    expect(realisePct + prevuPct).toBeLessThanOrEqual(100)
    // Le réalisé est un fait acquis : sa largeur ne doit pas être rabotée
    // pour faire de la place au prévisionnel.
    expect(realisePct).toBeCloseTo(90)
  })
})
