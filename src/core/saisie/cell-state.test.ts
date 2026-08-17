import { describe, it, expect } from 'vitest'
import { readCellState, cellStateToWrite, buildCellStates } from './cell-state'
import type { CellContext, CellEntry, CellReadContext } from './cell-state'
import type { Slot } from '../time/slots'

const SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
  { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 },
]

const CTX: CellContext = {
  minutesParJour: 480,
  slots: SLOTS,
  journeeDebutMinute: 540,
  journeeFinMinute: 1080,
}

/**
 * Une saisie telle qu'elle sort de la base : ses bornes **et son facteur** y
 * sont figés, et ne se recalculent donc jamais depuis les réglages courants.
 */
function saisie(
  minutes: number,
  slotId: string,
  startMinute: number,
  endMinute: number,
  minutesParJour = 480,
): CellEntry {
  return { minutes, slotId, startMinute, endMinute, minutesParJour }
}

/** Les bornes que `readCellState` reporte sur une journée ou une demi-journée. */
function bornes(startMinute: number, endMinute: number): { startMinute: number; endMinute: number } {
  return { startMinute, endMinute }
}

describe('readCellState', () => {
  it('lit une case sans saisie comme vide', () => {
    expect(readCellState([], CTX)).toEqual({ kind: 'VIDE' })
  })

  it('ignore une saisie à zéro minute', () => {
    expect(readCellState([saisie(0, '', 540, 1020)], CTX)).toEqual({ kind: 'VIDE' })
  })

  it('lit une journée pleine sans créneau comme JOURNEE', () => {
    expect(readCellState([saisie(480, '', 540, 1020)], CTX)).toEqual({
      kind: 'JOURNEE',
      bornes: bornes(540, 1020),
    })
  })

  it('lit une journée pleine à facteur court comme JOURNEE', () => {
    expect(readCellState([saisie(432, '', 540, 972, 432)], CTX)).toEqual({
      kind: 'JOURNEE',
      bornes: bornes(540, 972),
    })
  })

  it('lit la valeur nominale d un créneau comme une demi-journée', () => {
    expect(readCellState([saisie(240, 'matin', 540, 780)], CTX)).toEqual({
      kind: 'DEMI',
      slotId: 'matin',
      bornes: bornes(540, 780),
    })
  })

  it('lit une durée hors nominal sur un créneau comme une valeur libre', () => {
    expect(readCellState([saisie(180, 'matin', 540, 720)], CTX)).toEqual({
      kind: 'LIBRE',
      minutes: 180,
      slotId: 'matin',
      startMinute: 540,
      endMinute: 720,
      eclatee: false,
    })
  })

  it('lit une durée partielle sans créneau comme une valeur libre', () => {
    expect(readCellState([saisie(180, '', 540, 720)], CTX)).toEqual({
      kind: 'LIBRE',
      minutes: 180,
      slotId: '',
      startMinute: 540,
      endMinute: 720,
      eclatee: false,
    })
  })

  it('lit une saisie sur un créneau inconnu comme une valeur libre', () => {
    expect(readCellState([saisie(240, 'inconnu', 600, 840)], CTX)).toEqual({
      kind: 'LIBRE',
      minutes: 240,
      slotId: 'inconnu',
      startMinute: 600,
      endMinute: 840,
      eclatee: false,
    })
  })

  // Les bornes viennent de la saisie, jamais des réglages : c'est là que le
  // gel se casserait en lecture. Le créneau « matin » a été redéfini depuis,
  // la saisie garde ses heures.
  it('rend les bornes figées de la saisie, pas celles du créneau courant', () => {
    const redefini: CellContext = {
      ...CTX,
      slots: [{ id: 'matin', label: 'Matin', startMinute: 300, endMinute: 480, centiemes: 50 }],
    }
    expect(readCellState([saisie(180, 'matin', 540, 720)], redefini)).toEqual({
      kind: 'LIBRE',
      minutes: 180,
      slotId: 'matin',
      startMinute: 540,
      endMinute: 720,
      eclatee: false,
    })
  })

  // Deux demi-journées font bien 480 minutes : les lire comme JOURNEE ferait
  // du clic suivant un remplacement de deux saisies par une seule, en silence.
  it('lit deux créneaux du même jour comme une valeur libre éclatée', () => {
    expect(
      readCellState([saisie(240, 'matin', 540, 780), saisie(240, 'apres-midi', 840, 1080)], CTX),
    ).toEqual({
      kind: 'LIBRE',
      minutes: 480,
      slotId: '',
      startMinute: 540,
      endMinute: 1080,
      eclatee: true,
    })
  })

  // L'enveloppe se lit dans l'ordre des débuts, pas dans celui du tableau :
  // la base ne promet aucun tri.
  it('enveloppe une case éclatée du premier début à la dernière fin', () => {
    expect(
      readCellState([saisie(240, 'apres-midi', 840, 1080), saisie(240, 'matin', 540, 780)], CTX),
    ).toMatchObject({ startMinute: 540, endMinute: 1080, eclatee: true })
  })

  /**
   * C2 — le gel du facteur se casse **en lecture**.
   *
   * La colonne `minutesParJour` peut rester parfaitement intacte en base
   * pendant qu'un lecteur classe la case sous le réglage *courant* : une
   * journée pleine écrite à 420 minutes cessait d'être une journée dès que
   * l'administrateur passait la prestation à 480, et le calendrier affichait
   * « 1 » là où le tableau affichait « 1,14 » — deux vues du même écran, deux
   * valeurs, sur un CRA validé, sans qu'aucune donnée n'ait bougé.
   *
   * Le facteur courant n'entre plus dans `CellReadContext` : une lecture qui
   * aurait de quoi reconvertir finirait par le faire.
   */
  describe('le facteur est celui de la saisie, jamais le réglage courant', () => {
    it('lit une journée figée à 420 comme une journée entière', () => {
      expect(readCellState([saisie(420, '', 480, 900, 420)], CTX)).toEqual({
        kind: 'JOURNEE',
        bornes: bornes(480, 900),
      })
    })

    it('ne lit pas une saisie de 480 figée à 420 comme une journée entière', () => {
      // 480 minutes sous un facteur de 420, c'est 1,14 jour : ni une journée,
      // ni une demi-journée — une valeur libre, que les deux vues affichent
      // avec le même chiffre.
      expect(readCellState([saisie(480, '', 540, 1020, 420)], CTX)).toEqual({
        kind: 'LIBRE',
        minutes: 480,
        slotId: '',
        startMinute: 540,
        endMinute: 1020,
        eclatee: false,
      })
    })

    it('lit une demi-journée sous le facteur figé de sa saisie', () => {
      // 210 minutes = la moitié de 420. Sous le facteur courant (480), la
      // moitié vaudrait 240 : la case tombait alors en valeur libre.
      expect(readCellState([saisie(210, 'matin', 540, 750, 420)], CTX)).toEqual({
        kind: 'DEMI',
        slotId: 'matin',
        bornes: bornes(540, 750),
      })
    })

    // Le contexte de lecture ne porte que les créneaux : il n'y a plus de
    // facteur courant à consulter. Le contrôle de comportement — « un CRA
    // validé rend les mêmes chiffres après un changement de réglage » — vit
    // là où le facteur existe encore, dans `MonthCalendar.test.tsx`.
    it('ne demande rien d autre que les créneaux pour lire une case', () => {
      const lecture: CellReadContext = { slots: SLOTS }
      expect(readCellState([saisie(420, '', 480, 900, 420)], lecture)).toEqual({
        kind: 'JOURNEE',
        bornes: bornes(480, 900),
      })
    })
  })

  it('ne compte pas les saisies à zéro dans le total d une case éclatée', () => {
    const etat = readCellState(
      [saisie(240, 'matin', 540, 780), saisie(0, 'apres-midi', 840, 1080)],
      CTX,
    )
    expect(etat).toEqual({ kind: 'DEMI', slotId: 'matin', bornes: bornes(540, 780) })
  })
})

describe('cellStateToWrite', () => {
  it('n écrit rien pour une case vide', () => {
    expect(cellStateToWrite({ kind: 'VIDE' }, CTX)).toEqual([])
  })

  it('écrit une journée entière sans créneau, bornée par la plage journée', () => {
    expect(cellStateToWrite({ kind: 'JOURNEE' }, CTX)).toEqual([saisie(480, '', 540, 1020)])
  })

  it('écrit la valeur nominale du créneau pour une demi-journée', () => {
    expect(cellStateToWrite({ kind: 'DEMI', slotId: 'matin' }, CTX)).toEqual([
      saisie(240, 'matin', 540, 780),
    ])
  })

  it('écrit une demi-journée au facteur figé de la prestation', () => {
    const court: CellContext = { ...CTX, minutesParJour: 420 }
    expect(cellStateToWrite({ kind: 'DEMI', slotId: 'apres-midi' }, court)).toEqual([
      saisie(210, 'apres-midi', 840, 1080, 420),
    ])
  })

  it('reporte les bornes d un créneau qui franchit minuit', () => {
    expect(cellStateToWrite({ kind: 'DEMI', slotId: 'nuit' }, CTX)).toEqual([
      saisie(240, 'nuit', 1320, 360),
    ])
  })

  it('écrit une valeur libre telle quelle, créneau et bornes compris', () => {
    expect(
      cellStateToWrite(
        {
          kind: 'LIBRE',
          minutes: 180,
          slotId: 'nuit',
          startMinute: 1320,
          endMinute: 60,
          eclatee: false,
        },
        CTX,
      ),
    ).toEqual([saisie(180, 'nuit', 1320, 60)])
  })

  it('remplace une case éclatée par une seule saisie', () => {
    expect(
      cellStateToWrite(
        {
          kind: 'LIBRE',
          minutes: 480,
          slotId: '',
          startMinute: 540,
          endMinute: 1080,
          eclatee: true,
        },
        CTX,
      ),
    ).toEqual([saisie(480, '', 540, 1080)])
  })

  it('lève sur un créneau inconnu plutôt que d écrire une durée arbitraire', () => {
    expect(() => cellStateToWrite({ kind: 'DEMI', slotId: 'inconnu' }, CTX)).toThrow()
  })

  // L'aller-retour rend l'état **et ses bornes** : ce que l'écriture a figé,
  // la lecture le reporte. Sans elles, le formulaire les recalculerait depuis
  // les réglages courants — le défaut M1.
  it('fait l aller-retour sans perte pour les états du cycle', () => {
    for (const [etat, attendues] of [
      [{ kind: 'JOURNEE' } as const, bornes(540, 1020)],
      [{ kind: 'DEMI', slotId: 'matin' } as const, bornes(540, 780)],
      [{ kind: 'DEMI', slotId: 'apres-midi' } as const, bornes(840, 1080)],
    ] as const) {
      expect(readCellState(cellStateToWrite(etat, CTX), CTX)).toEqual({ ...etat, bornes: attendues })
    }
  })
})

describe('buildCellStates', () => {
  const entries = [
    { lineId: 'l1', date: '2026-03-02', ...saisie(480, '', 540, 1020) },
    { lineId: 'l1', date: '2026-03-03', ...saisie(240, 'matin', 540, 780) },
    { lineId: 'l2', date: '2026-03-02', ...saisie(480, '', 540, 1020) },
  ]

  it('indexe les états par date pour la seule prestation demandée', () => {
    const etats = buildCellStates(entries, 'l1', CTX)
    expect(etats.get('2026-03-02')).toEqual({ kind: 'JOURNEE', bornes: bornes(540, 1020) })
    expect(etats.get('2026-03-03')).toEqual({
      kind: 'DEMI',
      slotId: 'matin',
      bornes: bornes(540, 780),
    })
    expect(etats.size).toBe(2)
  })

  it('ne mêle jamais les saisies d une autre prestation', () => {
    const etats = buildCellStates(entries, 'l2', CTX)
    expect(etats.size).toBe(1)
    expect(etats.get('2026-03-02')).toEqual({ kind: 'JOURNEE', bornes: bornes(540, 1020) })
  })

  // Le facteur figé traverse `buildCellStates` : le laisser tomber en
  // recopiant la saisie était le chemin exact du défaut C2.
  it('reporte le facteur figé de chaque saisie jusqu au classement', () => {
    const etats = buildCellStates(
      [{ lineId: 'l1', date: '2026-03-05', ...saisie(420, '', 480, 900, 420) }],
      'l1',
      CTX,
    )
    expect(etats.get('2026-03-05')).toEqual({ kind: 'JOURNEE', bornes: bornes(480, 900) })
  })

  it('regroupe plusieurs créneaux du même jour dans une seule case', () => {
    const etats = buildCellStates(
      [
        { lineId: 'l1', date: '2026-03-04', ...saisie(240, 'matin', 540, 780) },
        { lineId: 'l1', date: '2026-03-04', ...saisie(240, 'apres-midi', 840, 1080) },
      ],
      'l1',
      CTX,
    )
    expect(etats.get('2026-03-04')).toEqual({
      kind: 'LIBRE',
      minutes: 480,
      slotId: '',
      startMinute: 540,
      endMinute: 1080,
      eclatee: true,
    })
  })

  it('ne pose aucune entrée pour une prestation sans saisie', () => {
    expect(buildCellStates(entries, 'l3', CTX).size).toBe(0)
  })
})
