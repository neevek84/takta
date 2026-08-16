import { describe, it, expect } from 'vitest'
import { nextCellState, cycleSlotIds, isSlotAllowed } from './cycle'
import type { CellState, CycleOptions } from './cycle'
import type { Slot } from '../time/slots'

const SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
  { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 },
]

const JOUR: CycleOptions = { demiSlotIds: ['matin', 'apres-midi'], displayUnit: 'JOUR' }

/** Enchaîne `n` clics et rend les états traversés. Échoue si un clic ouvre le formulaire. */
function clics(depart: CellState, n: number, options: CycleOptions): CellState[] {
  const parcours: CellState[] = []
  let courant = depart
  for (let i = 0; i < n; i++) {
    const step = nextCellState(courant, options)
    if (step.action !== 'ETAT') throw new Error(`clic ${i + 1} : formulaire au lieu d'un état`)
    courant = step.state
    parcours.push(courant)
  }
  return parcours
}

describe('nextCellState', () => {
  it('avance vide → 1 jour → ½ matin → ½ après-midi → vide', () => {
    expect(clics({ kind: 'VIDE' }, 4, JOUR)).toEqual([
      { kind: 'JOURNEE' },
      { kind: 'DEMI', slotId: 'matin' },
      { kind: 'DEMI', slotId: 'apres-midi' },
      { kind: 'VIDE' },
    ])
  })

  it('ramène la case à son état initial au bout de quatre clics', () => {
    const parcours = clics({ kind: 'VIDE' }, 4, JOUR)
    expect(parcours[parcours.length - 1]).toEqual({ kind: 'VIDE' })
  })

  // Le test qui protège contre la perte silencieuse : sans lui, un clic
  // distrait ramènerait trois heures à zéro, et le clic suivant les
  // remplacerait par une journée entière.
  it('ne cycle pas sur une case à valeur libre : elle rouvre son formulaire', () => {
    const libre: CellState = { kind: 'LIBRE', minutes: 180, slotId: '', startMinute: 540, endMinute: 720, eclatee: false }
    expect(nextCellState(libre, JOUR)).toEqual({ action: 'FORMULAIRE' })
  })

  it('rouvre le formulaire d une journée éclatée en plusieurs créneaux', () => {
    const eclatee: CellState = { kind: 'LIBRE', minutes: 480, slotId: '', startMinute: 540, endMinute: 720, eclatee: true }
    expect(nextCellState(eclatee, JOUR)).toEqual({ action: 'FORMULAIRE' })
  })

  it('ouvre directement le formulaire sur une prestation facturée à l heure', () => {
    const heure: CycleOptions = { ...JOUR, displayUnit: 'HEURE' }
    // Aucun état de départ ne doit produire « 1 jour » : ça n'y veut rien dire.
    expect(nextCellState({ kind: 'VIDE' }, heure)).toEqual({ action: 'FORMULAIRE' })
    expect(nextCellState({ kind: 'JOURNEE' }, heure)).toEqual({ action: 'FORMULAIRE' })
    expect(nextCellState({ kind: 'DEMI', slotId: 'matin' }, heure)).toEqual({ action: 'FORMULAIRE' })
  })

  it('se réduit à vide → 1 jour → vide quand aucun créneau n est proposé', () => {
    const sansDemi: CycleOptions = { demiSlotIds: [], displayUnit: 'JOUR' }
    expect(clics({ kind: 'VIDE' }, 2, sansDemi)).toEqual([{ kind: 'JOURNEE' }, { kind: 'VIDE' }])
  })

  it('n offre que le créneau autorisé quand la prestation en restreint un seul', () => {
    const unSeul: CycleOptions = { demiSlotIds: ['matin'], displayUnit: 'JOUR' }
    expect(clics({ kind: 'VIDE' }, 3, unSeul)).toEqual([
      { kind: 'JOURNEE' },
      { kind: 'DEMI', slotId: 'matin' },
      { kind: 'VIDE' },
    ])
  })

  it('vide une demi-journée posée sur un créneau hors du cycle', () => {
    // Cas réel : la saisie a été faite au formulaire, ou la restriction a été
    // ajoutée après coup. Le créneau est traité comme le dernier du cycle.
    expect(nextCellState({ kind: 'DEMI', slotId: 'nuit' }, JOUR)).toEqual({
      action: 'ETAT',
      state: { kind: 'VIDE' },
    })
  })

  it('accepte une prestation en demi-journées comme une prestation en jours', () => {
    const demiJour: CycleOptions = { ...JOUR, displayUnit: 'DEMI_JOUR' }
    expect(nextCellState({ kind: 'VIDE' }, demiJour)).toEqual({
      action: 'ETAT',
      state: { kind: 'JOURNEE' },
    })
  })
})

describe('cycleSlotIds', () => {
  it('propose les deux moitiés de la journée et écarte la nuit', () => {
    // Un créneau qui franchit minuit s'étale sur deux jours : il ne peut pas
    // être l'une des deux moitiés de celui-ci.
    expect(cycleSlotIds(SLOTS, [])).toEqual(['matin', 'apres-midi'])
  })

  it('respecte la restriction portée par la prestation', () => {
    expect(cycleSlotIds(SLOTS, ['matin'])).toEqual(['matin'])
  })

  it('rend une liste vide quand seule la nuit est autorisée', () => {
    expect(cycleSlotIds(SLOTS, ['nuit'])).toEqual([])
  })

  it('garde l ordre des créneaux tel que les réglages les déclarent', () => {
    const inverses = [SLOTS[1]!, SLOTS[0]!, SLOTS[2]!]
    expect(cycleSlotIds(inverses, [])).toEqual(['apres-midi', 'matin'])
  })

  it('rend une liste vide sans aucun créneau réglé', () => {
    expect(cycleSlotIds([], [])).toEqual([])
  })
})

describe('isSlotAllowed', () => {
  it('autorise tout quand la prestation ne restreint rien', () => {
    expect(isSlotAllowed('nuit', [])).toBe(true)
  })

  it('autorise un créneau listé', () => {
    expect(isSlotAllowed('matin', ['matin', 'apres-midi'])).toBe(true)
  })

  it('refuse un créneau hors de la liste', () => {
    expect(isSlotAllowed('nuit', ['matin', 'apres-midi'])).toBe(false)
  })

  it('autorise toujours la journée entière, qui ne porte aucun créneau', () => {
    expect(isSlotAllowed('', ['matin'])).toBe(true)
  })
})
