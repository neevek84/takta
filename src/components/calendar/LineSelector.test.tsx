// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LineSelector } from './LineSelector'
import { readSelection, writeSelection } from './selection-storage'
import type { LineForGrid } from '@/services/missions'

function ligne(over: Partial<LineForGrid>): LineForGrid {
  return {
    id: 'l1', label: 'Consultant ITSM', missionLabel: 'ITSM', clientName: 'ACME',
    displayUnit: 'JOUR', minutesParJour: 480, soldCentiemes: 3000, allowedSlotIds: [], ...over,
  }
}

const lines: LineForGrid[] = [
  ligne({}),
  ligne({ id: 'l2', label: 'Consultant ITSM Nuit' }),
  ligne({ id: 'l3', label: 'Run', missionLabel: 'Infogérance', clientName: 'BETA' }),
  ligne({ id: 'l4', label: 'Audit', missionLabel: 'Audit 2026' }),
]

function client(): HTMLSelectElement {
  return screen.getByLabelText('Client') as HTMLSelectElement
}
function mission(): HTMLSelectElement {
  return screen.getByLabelText('Mission') as HTMLSelectElement
}
function prestation(): HTMLSelectElement {
  return screen.getByLabelText('Prestation') as HTMLSelectElement
}

describe('selection-storage', () => {
  beforeEach(() => window.localStorage.clear())

  it('ne rend rien avant toute mémorisation', () => {
    expect(readSelection()).toBeNull()
  })

  it('relit ce qu il a écrit', () => {
    writeSelection('l2')
    expect(readSelection()).toBe('l2')
  })
})

describe('LineSelector', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(cleanup)

  it('affiche les trois sélecteurs', () => {
    render(<LineSelector lines={lines} lineId="l1" onChange={vi.fn()} />)
    expect(client()).toBeDefined()
    expect(mission()).toBeDefined()
    expect(prestation()).toBeDefined()
  })

  it('positionne les trois sélecteurs sur la prestation sélectionnée', () => {
    render(<LineSelector lines={lines} lineId="l3" onChange={vi.fn()} />)
    expect(client().value).toBe('BETA')
    expect(mission().value).toBe('Infogérance')
    expect(prestation().value).toBe('l3')
  })

  it('offre les deux prestations d une même mission', () => {
    render(<LineSelector lines={lines} lineId="l1" onChange={vi.fn()} />)
    expect(Array.from(prestation().options).map((o) => o.value)).toEqual(['l1', 'l2'])
  })

  it('ne propose que les missions du client choisi', () => {
    render(<LineSelector lines={lines} lineId="l3" onChange={vi.fn()} />)
    expect(Array.from(mission().options).map((o) => o.value)).toEqual(['Infogérance'])
    cleanup()

    render(<LineSelector lines={lines} lineId="l1" onChange={vi.fn()} />)
    expect(Array.from(mission().options).map((o) => o.value)).toEqual(['ITSM', 'Audit 2026'])
  })

  it('bascule sur la première prestation du client choisi', () => {
    const onChange = vi.fn()
    render(<LineSelector lines={lines} lineId="l1" onChange={onChange} />)

    fireEvent.change(client(), { target: { value: 'BETA' } })
    expect(onChange).toHaveBeenCalledWith('l3')
  })

  it('bascule sur la première prestation de la mission choisie', () => {
    const onChange = vi.fn()
    render(<LineSelector lines={lines} lineId="l1" onChange={onChange} />)

    fireEvent.change(mission(), { target: { value: 'Audit 2026' } })
    expect(onChange).toHaveBeenCalledWith('l4')
  })

  it('revient sur la première prestation en changeant de client', () => {
    const onChange = vi.fn()
    render(<LineSelector lines={lines} lineId="l3" onChange={onChange} />)

    fireEvent.change(client(), { target: { value: 'ACME' } })
    expect(onChange).toHaveBeenCalledWith('l1')
  })

  it('transmet le changement de prestation', () => {
    const onChange = vi.fn()
    render(<LineSelector lines={lines} lineId="l1" onChange={onChange} />)

    fireEvent.change(prestation(), { target: { value: 'l2' } })
    expect(onChange).toHaveBeenCalledWith('l2')
  })

  it('mémorise la prestation choisie', () => {
    render(<LineSelector lines={lines} lineId="l1" onChange={vi.fn()} />)
    fireEvent.change(prestation(), { target: { value: 'l2' } })
    expect(readSelection()).toBe('l2')
  })

  // Écrire au montage écraserait la mémoire avec la valeur par défaut avant
  // que la page ait eu le temps de la relire : les effets de l'enfant partent
  // toujours avant ceux du parent.
  it('n écrit rien au simple affichage', () => {
    window.localStorage.setItem('cra.saisie.prestation', 'l2')
    render(<LineSelector lines={lines} lineId="l1" onChange={vi.fn()} />)
    expect(readSelection()).toBe('l2')
  })

  it('le dit quand l utilisateur n a aucune prestation', () => {
    render(<LineSelector lines={[]} lineId="" onChange={vi.fn()} />)
    expect(screen.getByText(/aucune prestation/i)).toBeDefined()
  })
})
