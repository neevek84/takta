import { describe, it, expect } from 'vitest'
import { trajetsAPoser } from './trajets'

const aucun = { dejaPoses: [], autresBlocs: [] }

describe('trajetsAPoser', () => {
  it('pose un aller juste avant et un retour juste après', () => {
    expect(trajetsAPoser({ bloc: { startMinute: 540, endMinute: 1020 }, dureeMinutes: 30, ...aucun })).toEqual([
      { startMinute: 510, endMinute: 540 },
      { startMinute: 1020, endMinute: 1050 },
    ])
  })

  it('ne pose rien quand la durée de trajet est nulle', () => {
    expect(trajetsAPoser({ bloc: { startMinute: 540, endMinute: 1020 }, dureeMinutes: 0, ...aucun })).toEqual([])
  })

  // Journée chez A jusqu'à 17 h, rendez-vous chez B à 17 h 45 : le retour de A
  // est déjà posé, l'aller de B se contente de ce qui reste.
  it('raccourcit l aller contre un trajet déjà posé', () => {
    expect(
      trajetsAPoser({
        bloc: { startMinute: 1065, endMinute: 1125 },
        dureeMinutes: 30,
        dejaPoses: [{ startMinute: 1020, endMinute: 1050 }],
        autresBlocs: [],
      }),
    ).toEqual([
      { startMinute: 1050, endMinute: 1065 },
      { startMinute: 1125, endMinute: 1155 },
    ])
  })

  it('raccourcit le retour contre un autre bloc de travail', () => {
    expect(
      trajetsAPoser({
        bloc: { startMinute: 540, endMinute: 720 },
        dureeMinutes: 30,
        dejaPoses: [],
        autresBlocs: [{ startMinute: 735, endMinute: 900 }],
      }),
    ).toEqual([
      { startMinute: 510, endMinute: 540 },
      { startMinute: 720, endMinute: 735 },
    ])
  })

  it('ne pose pas un trajet réduit à rien', () => {
    expect(
      trajetsAPoser({
        bloc: { startMinute: 540, endMinute: 600 },
        dureeMinutes: 30,
        dejaPoses: [],
        autresBlocs: [{ startMinute: 420, endMinute: 540 }],
      }),
    ).toEqual([{ startMinute: 600, endMinute: 630 }])
  })

  it('ne pose pas d aller quand un autre bloc chevauche le début', () => {
    expect(
      trajetsAPoser({
        bloc: { startMinute: 540, endMinute: 600 },
        dureeMinutes: 30,
        dejaPoses: [],
        autresBlocs: [{ startMinute: 500, endMinute: 560 }],
      }),
    ).toEqual([{ startMinute: 600, endMinute: 630 }])
  })

  it('tronque l aller à minuit', () => {
    expect(trajetsAPoser({ bloc: { startMinute: 10, endMinute: 60 }, dureeMinutes: 30, ...aucun })[0]).toEqual({
      startMinute: 0,
      endMinute: 10,
    })
  })

  it('tronque le retour à minuit, noté 0', () => {
    expect(trajetsAPoser({ bloc: { startMinute: 1380, endMinute: 1430 }, dureeMinutes: 30, ...aucun })[1]).toEqual({
      startMinute: 1430,
      endMinute: 0,
    })
  })

  it('ne pose pas de retour après un bloc qui finit à minuit ou le franchit', () => {
    expect(trajetsAPoser({ bloc: { startMinute: 1320, endMinute: 0 }, dureeMinutes: 30, ...aucun })).toEqual([
      { startMinute: 1290, endMinute: 1320 },
    ])
    expect(trajetsAPoser({ bloc: { startMinute: 1320, endMinute: 120 }, dureeMinutes: 30, ...aucun })).toEqual([
      { startMinute: 1290, endMinute: 1320 },
    ])
  })
})
