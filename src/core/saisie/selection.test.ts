import { describe, it, expect } from 'vitest'
import { clientsOf, missionsOf, linesOf, resolveSelection } from './selection'
import type { SelectableLine } from './selection'

// Le cas de la spec : une mission portant deux prestations qu'on distingue au
// sélecteur, jamais en devinant à quelle ligne appartient une case.
const LIGNES: SelectableLine[] = [
  { id: 'l1', label: 'Consultant ITSM', missionLabel: 'ITSM', clientName: 'ACME' },
  { id: 'l2', label: 'Consultant ITSM Nuit', missionLabel: 'ITSM', clientName: 'ACME' },
  { id: 'l3', label: 'Audit', missionLabel: 'Audit 2026', clientName: 'ACME' },
  { id: 'l4', label: 'Run', missionLabel: 'Infogérance', clientName: 'BETA' },
]

describe('clientsOf', () => {
  it('dédoublonne en gardant l ordre d arrivée', () => {
    expect(clientsOf(LIGNES)).toEqual(['ACME', 'BETA'])
  })

  it('rend une liste vide sans prestation', () => {
    expect(clientsOf([])).toEqual([])
  })
})

describe('missionsOf', () => {
  it('ne rend que les missions du client demandé', () => {
    expect(missionsOf(LIGNES, 'ACME')).toEqual(['ITSM', 'Audit 2026'])
    expect(missionsOf(LIGNES, 'BETA')).toEqual(['Infogérance'])
  })

  it('rend une liste vide pour un client inconnu', () => {
    expect(missionsOf(LIGNES, 'GAMMA')).toEqual([])
  })
})

describe('linesOf', () => {
  it('rend les deux prestations d une même mission', () => {
    expect(linesOf(LIGNES, 'ACME', 'ITSM').map((l) => l.id)).toEqual(['l1', 'l2'])
  })

  it('ne franchit jamais la frontière du client', () => {
    expect(linesOf(LIGNES, 'BETA', 'ITSM')).toEqual([])
  })
})

describe('resolveSelection', () => {
  it('retombe sur la sélection mémorisée', () => {
    expect(resolveSelection(LIGNES, 'l3')).toEqual({
      clientName: 'ACME',
      missionLabel: 'Audit 2026',
      lineId: 'l3',
    })
  })

  it('retombe sur la première prestation quand rien n est mémorisé', () => {
    expect(resolveSelection(LIGNES, null)).toEqual({
      clientName: 'ACME',
      missionLabel: 'ITSM',
      lineId: 'l1',
    })
  })

  it('retombe sur la première prestation quand la mémoire pointe une prestation disparue', () => {
    // Prestation archivée, affectation retirée : la mémoire ne doit pas rendre
    // l'écran inutilisable.
    expect(resolveSelection(LIGNES, 'supprimee')?.lineId).toBe('l1')
  })

  it('rend null quand l utilisateur n a aucune prestation', () => {
    expect(resolveSelection([], 'l1')).toBeNull()
  })
})
