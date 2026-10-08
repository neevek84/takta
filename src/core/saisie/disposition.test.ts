import { describe, it, expect } from 'vitest'
import { disposerAplats } from './disposition'
import type { AplatDuJour } from './disposition'

const PLEINE = { kind: 'PLEINE' } as const
const AM = { kind: 'MOITIE', moment: 'AM' } as const
const PM = { kind: 'MOITIE', moment: 'PM' } as const

function aplat(lineId: string, forme: AplatDuJour['forme'], previsionnel = false): AplatDuJour {
  return { lineId, forme, previsionnel }
}

describe('disposerAplats', () => {
  it('ne pose rien sur un jour sans saisie', () => {
    expect(disposerAplats([])).toEqual([])
  })

  it('écarte les prestations qui ne dessinent rien ce jour-là', () => {
    expect(disposerAplats([aplat('A', { kind: 'AUCUNE' })])).toEqual([])
  })

  it('donne toute la case à une seule autre prestation, à sa forme', () => {
    expect(disposerAplats([aplat('B', PLEINE)])).toEqual([
      { lineId: 'B', forme: PLEINE, previsionnel: false, bande: 0, bandes: 1 },
    ])
  })

  // Le matin de l'une et l'après-midi de l'autre ne se recouvrent pas : la
  // diagonale les sépare déjà, et c'est la lecture la plus juste de la journée.
  it('superpose un matin et un après-midi de deux prestations, sans bandes', () => {
    const disposes = disposerAplats([aplat('A', AM), aplat('B', PM)])
    expect(disposes.map((d) => [d.lineId, d.forme, d.bande, d.bandes])).toEqual([
      ['A', AM, 0, 1],
      ['B', PM, 0, 1],
    ])
  })

  it('partage la case en deux bandes verticales pour deux journées entières', () => {
    const disposes = disposerAplats([aplat('A', PLEINE), aplat('B', PLEINE)])
    expect(disposes.map((d) => [d.lineId, d.bande, d.bandes])).toEqual([
      ['A', 0, 2],
      ['B', 1, 2],
    ])
  })

  it('partage en bandes deux matins, qui se recouvriraient', () => {
    const disposes = disposerAplats([aplat('A', AM), aplat('B', AM)])
    expect(disposes.map((d) => d.bandes)).toEqual([2, 2])
  })

  it('partage en bandes deux durées partielles, chacune à sa hauteur', () => {
    const disposes = disposerAplats([
      aplat('A', { kind: 'PARTIELLE', fraction: 0.25 }),
      aplat('B', { kind: 'PARTIELLE', fraction: 0.75 }),
    ])
    expect(disposes.map((d) => [d.forme, d.bande, d.bandes])).toEqual([
      [{ kind: 'PARTIELLE', fraction: 0.25 }, 0, 2],
      [{ kind: 'PARTIELLE', fraction: 0.75 }, 1, 2],
    ])
  })

  it('donne une bande par prestation au-delà de deux, dans l’ordre reçu', () => {
    const disposes = disposerAplats([aplat('A', AM), aplat('B', PM), aplat('C', PLEINE)])
    expect(disposes.map((d) => [d.lineId, d.forme, d.bande, d.bandes])).toEqual([
      ['A', AM, 0, 3],
      ['B', PM, 1, 3],
      ['C', PLEINE, 2, 3],
    ])
  })

  it('ne compte pas dans les bandes une prestation qui ne dessine rien', () => {
    const disposes = disposerAplats([
      aplat('A', PLEINE),
      aplat('B', { kind: 'AUCUNE' }),
      aplat('C', PLEINE),
    ])
    expect(disposes.map((d) => [d.lineId, d.bande, d.bandes])).toEqual([
      ['A', 0, 2],
      ['C', 1, 2],
    ])
  })

  it('garde le prévisionnel de chaque prestation', () => {
    const disposes = disposerAplats([aplat('A', PLEINE, true), aplat('B', PLEINE, false)])
    expect(disposes.map((d) => d.previsionnel)).toEqual([true, false])
  })
})
