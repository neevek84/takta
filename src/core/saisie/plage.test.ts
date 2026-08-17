import { describe, it, expect } from 'vitest'
import { positionDansLaPlage } from './plage'

describe('positionDansLaPlage', () => {
  it('fusionne trois jours contigus au même état', () => {
    const cles = ['R', 'R', 'R', null, null, null, null]
    expect(positionDansLaPlage(0, cles)).toBe('DEBUT')
    expect(positionDansLaPlage(1, cles)).toBe('MILIEU')
    expect(positionDansLaPlage(2, cles)).toBe('FIN')
  })

  it('ne fusionne jamais deux états différents', () => {
    // Un réalisé et un prévisionnel ne sont pas le même fait, même contigus.
    expect(positionDansLaPlage(1, ['R', 'P', 'P'])).toBe('DEBUT')
    expect(positionDansLaPlage(0, ['R', 'P', 'P'])).toBe('SEULE')
    expect(positionDansLaPlage(2, ['R', 'P', 'P'])).toBe('FIN')
  })

  it('isole un jour qui ne fusionne pas', () => {
    expect(positionDansLaPlage(0, [null, 'R'])).toBe('SEULE')
    expect(positionDansLaPlage(1, ['R', 'R', null])).toBe('FIN')
  })

  it('isole un jour dont les deux voisins sont vides', () => {
    expect(positionDansLaPlage(1, [null, 'R', null])).toBe('SEULE')
  })

  it('rend SEULE pour une case qui ne fusionne pas, quels que soient ses voisins', () => {
    // Une demi-journée, un week-end, une case hors mois : la clé vaut `null`,
    // et la case garde ses quatre filets même entourée de journées entières.
    expect(positionDansLaPlage(1, ['R', null, 'R'])).toBe('SEULE')
  })

  it('ne franchit pas la fin de semaine de la grille', () => {
    // sept colonnes : l'indice 6 est un dimanche, l'indice 7 un lundi. Une
    // plage ne franchit pas le dimanche, parce que la grille ne le montre pas.
    const cles = [null, null, null, null, null, null, 'R', 'R']
    expect(positionDansLaPlage(6, cles)).toBe('SEULE')
    expect(positionDansLaPlage(7, cles)).toBe('SEULE')
  })

  it('fusionne d un bout à l autre d une même semaine de grille', () => {
    const cles = ['R', 'R', 'R', 'R', 'R', 'R', 'R']
    expect(positionDansLaPlage(0, cles)).toBe('DEBUT')
    expect(positionDansLaPlage(3, cles)).toBe('MILIEU')
    expect(positionDansLaPlage(6, cles)).toBe('FIN')
  })

  it('reste SEULE hors des bornes de la grille', () => {
    expect(positionDansLaPlage(9, ['R', 'R'])).toBe('SEULE')
    expect(positionDansLaPlage(-1, ['R', 'R'])).toBe('SEULE')
  })
})
