import { describe, it, expect } from 'vitest'
import {
  canTransition,
  applyTransition,
  isLocked,
  isArrete,
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
  it('verrouille le CRA envoyé et le CRA validé, pas les autres', () => {
    expect(isLocked('VALIDE')).toBe(true)
    expect(isLocked('ENVOYE')).toBe(true)
    expect(isLocked('BROUILLON')).toBe(false)
    expect(isLocked('REFUSE')).toBe(false)
  })
})

describe('lot 3b — verrou, arrêt et nouvelles transitions', () => {
  it('ENVOYE ferme la saisie, comme VALIDE', () => {
    expect(isLocked('ENVOYE')).toBe(true)
    expect(isLocked('VALIDE')).toBe(true)
    expect(isLocked('BROUILLON')).toBe(false)
    // Un refus rend le mois modifiable : c'est tout l'intérêt de refuser.
    expect(isLocked('REFUSE')).toBe(false)
  })

  it('seul VALIDE arrête le mois — ENVOYE ne doit rien pousser vers Dolibarr', () => {
    expect(isArrete('VALIDE')).toBe(true)
    expect(isArrete('ENVOYE')).toBe(false)
    expect(isArrete('BROUILLON')).toBe(false)
    expect(isArrete('REFUSE')).toBe(false)
  })

  it('RENVOYER part de REFUSE vers ENVOYE, et de nulle part ailleurs', () => {
    expect(applyTransition('REFUSE', 'RENVOYER')).toBe('ENVOYE')
    expect(canTransition('BROUILLON', 'RENVOYER')).toBe(false)
    expect(canTransition('ENVOYE', 'RENVOYER')).toBe(false)
    expect(canTransition('VALIDE', 'RENVOYER')).toBe(false)
  })

  it('ANNULER_ENVOI part de ENVOYE vers BROUILLON ; ROUVRIR reste refusé depuis ENVOYE', () => {
    expect(applyTransition('ENVOYE', 'ANNULER_ENVOI')).toBe('BROUILLON')
    expect(canTransition('ENVOYE', 'ROUVRIR')).toBe(false)
    expect(canTransition('REFUSE', 'ANNULER_ENVOI')).toBe(false)
    expect(canTransition('VALIDE', 'ANNULER_ENVOI')).toBe(false)
  })
})
