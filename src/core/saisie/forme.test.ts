import { describe, it, expect } from 'vitest'
import { formeDeLaCase, signatureDeForme } from './forme'
import type { Forme } from './forme'
import type { CellState } from './cycle'
import type { Slot } from '../time/slots'
import type { MinutesAuFacteur } from '../time/units'

const SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
  { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 },
]

const RIEN: MinutesAuFacteur[] = []

describe('formeDeLaCase', () => {
  it('ne dessine rien sur une case vide', () => {
    expect(formeDeLaCase({ kind: 'VIDE' }, RIEN, SLOTS)).toEqual({ kind: 'AUCUNE' })
  })

  it('remplit toute la case pour une journée entière', () => {
    expect(formeDeLaCase({ kind: 'JOURNEE' }, RIEN, SLOTS)).toEqual({ kind: 'PLEINE' })
  })

  // La convention retenue par le porteur : le matin en haut, l'après-midi en
  // bas, de part et d'autre d'une diagonale qui monte de bas-gauche à
  // haut-droite. Ce qui se lit sans l'apprendre.
  it('pose le matin sur la moitié haute-gauche et l’après-midi sur la basse-droite', () => {
    expect(formeDeLaCase({ kind: 'DEMI', slotId: 'matin' }, RIEN, SLOTS)).toEqual({
      kind: 'MOITIE',
      moment: 'AM',
    })
    expect(formeDeLaCase({ kind: 'DEMI', slotId: 'apres-midi' }, RIEN, SLOTS)).toEqual({
      kind: 'MOITIE',
      moment: 'PM',
    })
  })

  // Un créneau qui franchit minuit n'est ni au-dessus ni en dessous de la
  // diagonale : le ranger d'un côté mentirait. Il se dessine alors comme une
  // durée libre, à sa proportion, et son libellé dit lequel c'est.
  it('dessine un créneau qui franchit minuit à sa proportion, sans diagonale', () => {
    expect(formeDeLaCase({ kind: 'DEMI', slotId: 'nuit' }, RIEN, SLOTS)).toEqual({
      kind: 'PARTIELLE',
      fraction: 0.5,
    })
  })

  it('dessine une durée libre à sa proportion', () => {
    const etat: CellState = { kind: 'LIBRE', minutes: 120, slotId: '', startMinute: 540, endMinute: 720, eclatee: false }
    expect(formeDeLaCase(etat, [{ minutes: 120, minutesParJour: 480 }], SLOTS)).toEqual({
      kind: 'PARTIELLE',
      fraction: 0.25,
    })
  })

  // Le piège le plus répété du projet : convertir la somme des minutes sous un
  // facteur global. 240 min à 480/jour valent 0,50 j et 240 min à 420/jour en
  // valent 0,57 — soit 1,07 j au total, jamais 480/480 = 1 j. La forme se
  // sature à la case pleine plutôt que de déborder.
  it('convertit chaque saisie sous le facteur figé à son écriture', () => {
    const etat: CellState = { kind: 'LIBRE', minutes: 480, slotId: '', startMinute: 540, endMinute: 720, eclatee: true }
    const forme = formeDeLaCase(
      etat,
      [
        { minutes: 240, minutesParJour: 480 },
        { minutes: 120, minutesParJour: 420 },
      ],
      SLOTS,
    )
    // 0,50 + 0,29 = 0,79 — et non 360/480 = 0,75.
    expect(forme).toEqual({ kind: 'PARTIELLE', fraction: 0.79 })
  })

  it('ne déborde jamais de la case', () => {
    const etat: CellState = { kind: 'LIBRE', minutes: 960, slotId: '', startMinute: 540, endMinute: 720, eclatee: false }
    expect(formeDeLaCase(etat, [{ minutes: 960, minutesParJour: 480 }], SLOTS)).toEqual({
      kind: 'PARTIELLE',
      fraction: 1,
    })
  })

  it('ne dessine rien pour une durée libre nulle', () => {
    const etat: CellState = { kind: 'LIBRE', minutes: 0, slotId: '', startMinute: 540, endMinute: 720, eclatee: false }
    expect(formeDeLaCase(etat, [{ minutes: 0, minutesParJour: 480 }], SLOTS)).toEqual({
      kind: 'AUCUNE',
    })
  })

  // Un créneau retiré des réglages après la saisie : la case reste dessinée,
  // au pire à sa proportion nominale de demi-journée.
  it('ne s’effondre pas quand le créneau a disparu des réglages', () => {
    expect(formeDeLaCase({ kind: 'DEMI', slotId: 'disparu' }, RIEN, SLOTS)).toEqual({
      kind: 'PARTIELLE',
      fraction: 0.5,
    })
  })
})

describe('signatureDeForme', () => {
  // La règle du projet : aucune information portée par la seule couleur. Deux
  // états qui partagent la même signature seraient indistinguables en vision
  // monochrome — c'est exactement ce que ce test refuse.
  it('donne une signature différente à chacun des états de la case', () => {
    const formes: Forme[] = [
      formeDeLaCase({ kind: 'VIDE' }, RIEN, SLOTS),
      formeDeLaCase({ kind: 'JOURNEE' }, RIEN, SLOTS),
      formeDeLaCase({ kind: 'DEMI', slotId: 'matin' }, RIEN, SLOTS),
      formeDeLaCase({ kind: 'DEMI', slotId: 'apres-midi' }, RIEN, SLOTS),
      formeDeLaCase(
        { kind: 'LIBRE', minutes: 180, slotId: '', startMinute: 540, endMinute: 720, eclatee: false },
        [{ minutes: 180, minutesParJour: 480 }],
        SLOTS,
      ),
    ]
    const signatures = formes.map(signatureDeForme)
    expect(new Set(signatures).size).toBe(formes.length)
  })

  it('nomme la moitié qu’elle dessine', () => {
    expect(signatureDeForme({ kind: 'MOITIE', moment: 'AM' })).toBe('MOITIE-AM')
    expect(signatureDeForme({ kind: 'MOITIE', moment: 'PM' })).toBe('MOITIE-PM')
    expect(signatureDeForme({ kind: 'PLEINE' })).toBe('PLEINE')
    expect(signatureDeForme({ kind: 'AUCUNE' })).toBe('AUCUNE')
    expect(signatureDeForme({ kind: 'PARTIELLE', fraction: 0.25 })).toBe('PARTIELLE')
  })
})
