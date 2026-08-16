import { describe, it, expect } from 'vitest'
import { readCellState, cellStateToWrite, buildCellStates } from './cell-state'
import type { CellContext } from './cell-state'
import type { Slot } from '../time/slots'

const SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
  { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 },
]

const CTX: CellContext = { minutesParJour: 480, slots: SLOTS }

describe('readCellState', () => {
  it('lit une case sans saisie comme vide', () => {
    expect(readCellState([], CTX)).toEqual({ kind: 'VIDE' })
  })

  it('ignore une saisie à zéro minute', () => {
    expect(readCellState([{ minutes: 0, slotId: '' }], CTX)).toEqual({ kind: 'VIDE' })
  })

  it('lit une journée pleine sans créneau comme JOURNEE', () => {
    expect(readCellState([{ minutes: 480, slotId: '' }], CTX)).toEqual({ kind: 'JOURNEE' })
  })

  it('lit une journée pleine à facteur court comme JOURNEE', () => {
    const court: CellContext = { minutesParJour: 432, slots: SLOTS }
    expect(readCellState([{ minutes: 432, slotId: '' }], court)).toEqual({ kind: 'JOURNEE' })
  })

  it('lit la valeur nominale d un créneau comme une demi-journée', () => {
    expect(readCellState([{ minutes: 240, slotId: 'matin' }], CTX)).toEqual({
      kind: 'DEMI',
      slotId: 'matin',
    })
  })

  it('lit une durée hors nominal sur un créneau comme une valeur libre', () => {
    expect(readCellState([{ minutes: 180, slotId: 'matin' }], CTX)).toEqual({
      kind: 'LIBRE',
      minutes: 180,
      slotId: 'matin',
      eclatee: false,
    })
  })

  it('lit une durée partielle sans créneau comme une valeur libre', () => {
    expect(readCellState([{ minutes: 180, slotId: '' }], CTX)).toEqual({
      kind: 'LIBRE',
      minutes: 180,
      slotId: '',
      eclatee: false,
    })
  })

  it('lit une saisie sur un créneau inconnu comme une valeur libre', () => {
    expect(readCellState([{ minutes: 240, slotId: 'inconnu' }], CTX)).toEqual({
      kind: 'LIBRE',
      minutes: 240,
      slotId: 'inconnu',
      eclatee: false,
    })
  })

  // Deux demi-journées font bien 480 minutes : les lire comme JOURNEE ferait
  // du clic suivant un remplacement de deux saisies par une seule, en silence.
  it('lit deux créneaux du même jour comme une valeur libre éclatée', () => {
    expect(
      readCellState(
        [
          { minutes: 240, slotId: 'matin' },
          { minutes: 240, slotId: 'apres-midi' },
        ],
        CTX,
      ),
    ).toEqual({ kind: 'LIBRE', minutes: 480, slotId: '', eclatee: true })
  })

  it('ne compte pas les saisies à zéro dans le total d une case éclatée', () => {
    const etat = readCellState(
      [
        { minutes: 240, slotId: 'matin' },
        { minutes: 0, slotId: 'apres-midi' },
      ],
      CTX,
    )
    expect(etat).toEqual({ kind: 'DEMI', slotId: 'matin' })
  })
})

describe('cellStateToWrite', () => {
  it('n écrit rien pour une case vide', () => {
    expect(cellStateToWrite({ kind: 'VIDE' }, CTX)).toEqual([])
  })

  it('écrit une journée entière sans créneau', () => {
    expect(cellStateToWrite({ kind: 'JOURNEE' }, CTX)).toEqual([{ minutes: 480, slotId: '' }])
  })

  it('écrit la valeur nominale du créneau pour une demi-journée', () => {
    expect(cellStateToWrite({ kind: 'DEMI', slotId: 'matin' }, CTX)).toEqual([
      { minutes: 240, slotId: 'matin' },
    ])
  })

  it('écrit une demi-journée au facteur figé de la prestation', () => {
    const court: CellContext = { minutesParJour: 420, slots: SLOTS }
    expect(cellStateToWrite({ kind: 'DEMI', slotId: 'apres-midi' }, court)).toEqual([
      { minutes: 210, slotId: 'apres-midi' },
    ])
  })

  it('écrit une valeur libre telle quelle, créneau compris', () => {
    expect(
      cellStateToWrite({ kind: 'LIBRE', minutes: 180, slotId: 'nuit', eclatee: false }, CTX),
    ).toEqual([{ minutes: 180, slotId: 'nuit' }])
  })

  it('remplace une case éclatée par une seule saisie', () => {
    expect(
      cellStateToWrite({ kind: 'LIBRE', minutes: 480, slotId: '', eclatee: true }, CTX),
    ).toEqual([{ minutes: 480, slotId: '' }])
  })

  it('lève sur un créneau inconnu plutôt que d écrire une durée arbitraire', () => {
    expect(() => cellStateToWrite({ kind: 'DEMI', slotId: 'inconnu' }, CTX)).toThrow()
  })

  it('fait l aller-retour sans perte pour les états du cycle', () => {
    for (const etat of [
      { kind: 'JOURNEE' } as const,
      { kind: 'DEMI', slotId: 'matin' } as const,
      { kind: 'DEMI', slotId: 'apres-midi' } as const,
    ]) {
      expect(readCellState(cellStateToWrite(etat, CTX), CTX)).toEqual(etat)
    }
  })
})

describe('buildCellStates', () => {
  const entries = [
    { lineId: 'l1', date: '2026-03-02', minutes: 480, slotId: '' },
    { lineId: 'l1', date: '2026-03-03', minutes: 240, slotId: 'matin' },
    { lineId: 'l2', date: '2026-03-02', minutes: 480, slotId: '' },
  ]

  it('indexe les états par date pour la seule prestation demandée', () => {
    const etats = buildCellStates(entries, 'l1', CTX)
    expect(etats.get('2026-03-02')).toEqual({ kind: 'JOURNEE' })
    expect(etats.get('2026-03-03')).toEqual({ kind: 'DEMI', slotId: 'matin' })
    expect(etats.size).toBe(2)
  })

  it('ne mêle jamais les saisies d une autre prestation', () => {
    const etats = buildCellStates(entries, 'l2', CTX)
    expect(etats.size).toBe(1)
    expect(etats.get('2026-03-02')).toEqual({ kind: 'JOURNEE' })
  })

  it('regroupe plusieurs créneaux du même jour dans une seule case', () => {
    const etats = buildCellStates(
      [
        { lineId: 'l1', date: '2026-03-04', minutes: 240, slotId: 'matin' },
        { lineId: 'l1', date: '2026-03-04', minutes: 240, slotId: 'apres-midi' },
      ],
      'l1',
      CTX,
    )
    expect(etats.get('2026-03-04')).toEqual({
      kind: 'LIBRE',
      minutes: 480,
      slotId: '',
      eclatee: true,
    })
  })

  it('ne pose aucune entrée pour une prestation sans saisie', () => {
    expect(buildCellStates(entries, 'l3', CTX).size).toBe(0)
  })
})
