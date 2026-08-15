import { describe, it, expect } from 'vitest'
import {
  canTransition,
  applyTransition,
  isLocked,
  InvalidTransitionError,
} from './state-machine'

describe('canTransition', () => {
  it('autorise le parcours nominal', () => {
    expect(canTransition('BROUILLON', 'ENVOYER')).toBe(true)
    expect(canTransition('ENVOYE', 'VALIDER')).toBe(true)
  })

  it('autorise le refus depuis ENVOYE', () => {
    expect(canTransition('ENVOYE', 'REFUSER')).toBe(true)
  })

  it('autorise la réouverture depuis VALIDE et REFUSE', () => {
    expect(canTransition('VALIDE', 'ROUVRIR')).toBe(true)
    expect(canTransition('REFUSE', 'ROUVRIR')).toBe(true)
  })

  it('refuse de valider un brouillon sans envoi', () => {
    expect(canTransition('BROUILLON', 'VALIDER')).toBe(false)
  })

  it('refuse de rouvrir un brouillon', () => {
    expect(canTransition('BROUILLON', 'ROUVRIR')).toBe(false)
  })

  it('refuse de renvoyer un CRA validé', () => {
    expect(canTransition('VALIDE', 'ENVOYER')).toBe(false)
  })
})

describe('applyTransition', () => {
  it('renvoie le nouvel état', () => {
    expect(applyTransition('BROUILLON', 'ENVOYER')).toBe('ENVOYE')
    expect(applyTransition('ENVOYE', 'VALIDER')).toBe('VALIDE')
    expect(applyTransition('ENVOYE', 'REFUSER')).toBe('REFUSE')
    expect(applyTransition('VALIDE', 'ROUVRIR')).toBe('BROUILLON')
  })

  it('lève sur une transition interdite', () => {
    expect(() => applyTransition('BROUILLON', 'VALIDER')).toThrow(InvalidTransitionError)
  })
})

describe('isLocked', () => {
  it('verrouille uniquement le CRA validé', () => {
    expect(isLocked('VALIDE')).toBe(true)
    expect(isLocked('BROUILLON')).toBe(false)
    expect(isLocked('ENVOYE')).toBe(false)
    expect(isLocked('REFUSE')).toBe(false)
  })
})
