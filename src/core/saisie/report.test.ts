import { describe, it, expect } from 'vitest'
import { formatFillReport, formatClearReport } from './report'

describe('formatFillReport', () => {
  it('rend le compte rendu de la spec', () => {
    expect(
      formatFillReport({ poses: 18, sautesCapacite: 2, dejaSaisis: 0, verrouille: false }),
    ).toBe('18 jours posés, 2 sautés faute de capacité.')
  })

  it('accorde le singulier', () => {
    expect(
      formatFillReport({ poses: 1, sautesCapacite: 1, dejaSaisis: 1, verrouille: false }),
    ).toBe('1 jour posé, 1 sauté faute de capacité, 1 déjà saisi.')
  })

  it('compte les jours déjà saisis plutôt que de les écraser en silence', () => {
    expect(
      formatFillReport({ poses: 15, sautesCapacite: 0, dejaSaisis: 5, verrouille: false }),
    ).toBe('15 jours posés, 5 déjà saisis.')
  })

  it('ne mentionne que ce qui s est produit', () => {
    expect(
      formatFillReport({ poses: 20, sautesCapacite: 0, dejaSaisis: 0, verrouille: false }),
    ).toBe('20 jours posés.')
  })

  it('dit le verrou sans prétendre avoir posé quoi que ce soit', () => {
    expect(
      formatFillReport({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: true }),
    ).toBe("Le CRA de ce mois est validé : aucun jour n'a été posé.")
  })

  it('dit qu il n y avait rien à faire', () => {
    expect(
      formatFillReport({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: false }),
    ).toBe('Aucun jour ouvré à remplir sur ce mois.')
  })

  it('dit zéro posé quand tout a été sauté', () => {
    expect(
      formatFillReport({ poses: 0, sautesCapacite: 3, dejaSaisis: 0, verrouille: false }),
    ).toBe('0 jour posé, 3 sautés faute de capacité.')
  })
})

describe('formatClearReport', () => {
  it('compte les saisies retirées', () => {
    expect(formatClearReport({ supprimees: 3, verrouille: false })).toBe('3 saisies retirées.')
  })

  it('accorde le singulier', () => {
    expect(formatClearReport({ supprimees: 1, verrouille: false })).toBe('1 saisie retirée.')
  })

  it('dit qu il n y avait rien à retirer', () => {
    expect(formatClearReport({ supprimees: 0, verrouille: false })).toBe(
      'Aucune saisie à retirer sur ce mois pour cette prestation.',
    )
  })

  it('dit le verrou', () => {
    expect(formatClearReport({ supprimees: 0, verrouille: true })).toBe(
      "Le CRA de ce mois est validé : aucune saisie n'a été retirée.",
    )
  })
})
