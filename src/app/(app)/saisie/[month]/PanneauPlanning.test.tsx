// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { LineForGrid } from '@/services/missions'
import { PanneauPlanning, urlPlanning } from './PanneauPlanning'

afterEach(cleanup)

const ligne: LineForGrid = {
  id: 'l1',
  label: 'RSI de Transition',
  missionLabel: 'STTHOMAS',
  clientName: 'SPIE ICS',
  displayUnit: 'JOUR',
  minutesParJour: 480,
  soldCentiemes: 5200,
  allowedSlotIds: [],
  lieuDefaut: 'DISTANCE',
  modeCra: 'PRESTATION',
}

function lien(): string {
  return screen.getByRole('link', { name: 'Télécharger le PDF' }).getAttribute('href') ?? ''
}

describe('PanneauPlanning', () => {
  it('part de 3 mois à compter du mois affiché', () => {
    render(<PanneauPlanning month="2026-11" ligne={ligne} lignesDeLaMission={1} onFermer={() => {}} />)
    expect(lien()).toBe('/planning/pdf?ligne=l1&du=2026-11-01&au=2027-01-31')
  })

  it('recalcule la période quand on change de raccourci', () => {
    render(<PanneauPlanning month="2026-11" ligne={ligne} lignesDeLaMission={1} onFermer={() => {}} />)
    fireEvent.change(screen.getByLabelText('Période'), { target: { value: 'SIX_MOIS' } })
    expect(lien()).toContain('au=2027-04-30')
  })

  it('passe en « de date à date » dès qu’on touche une date', () => {
    render(<PanneauPlanning month="2026-11" ligne={ligne} lignesDeLaMission={1} onFermer={() => {}} />)
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2027-06-30' } })
    expect((screen.getByLabelText('Période') as HTMLSelectElement).value).toBe('PERSONNALISEE')
    expect(lien()).toContain('au=2027-06-30')
  })

  it('bloque le téléchargement sur une période invalide, en disant pourquoi', () => {
    render(<PanneauPlanning month="2026-11" ligne={ligne} lignesDeLaMission={1} onFermer={() => {}} />)
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-10-01' } })
    expect(screen.queryByRole('link', { name: 'Télécharger le PDF' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Télécharger le PDF' })).toHaveProperty('disabled', true)
    expect(screen.getByText('La date de fin précède la date de début.')).toBeTruthy()
  })

  it('ne propose toute la mission que s’il y a plusieurs prestations', () => {
    render(<PanneauPlanning month="2026-11" ligne={ligne} lignesDeLaMission={1} onFermer={() => {}} />)
    expect(screen.queryByLabelText('Toutes les prestations de la mission')).toBeNull()
    cleanup()
    render(<PanneauPlanning month="2026-11" ligne={ligne} lignesDeLaMission={2} onFermer={() => {}} />)
    fireEvent.click(screen.getByLabelText('Toutes les prestations de la mission'))
    expect(lien()).toContain('perimetre=MISSION')
  })

  it('se ferme', () => {
    const onFermer = vi.fn()
    render(<PanneauPlanning month="2026-11" ligne={ligne} lignesDeLaMission={1} onFermer={onFermer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(onFermer).toHaveBeenCalledOnce()
  })
})

describe('urlPlanning', () => {
  it('encode les paramètres', () => {
    expect(
      urlPlanning({ lineId: 'a b', periode: { du: '2026-11-01', au: '2026-11-30' }, toutLaMission: false }),
    ).toBe('/planning/pdf?ligne=a+b&du=2026-11-01&au=2026-11-30')
  })
})
