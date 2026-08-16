import { describe, it, expect } from 'vitest'
import { phraseCreneauNonPrevu } from './slot-labels'
import type { Slot } from '../time/slots'

const SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'nuit', label: 'Nuit (20 h – 4 h)', startMinute: 1200, endMinute: 240, centiemes: 50 },
]

describe('phraseCreneauNonPrevu', () => {
  // Le bug corrigé : la vue tableau affichait l'identifiant brut (« nuit »)
  // quand la vue calendrier affiche le libellé réglé en administration.
  it('nomme les créneaux par leur libellé réglé en administration, pas leur identifiant', () => {
    expect(phraseCreneauNonPrevu(['nuit'], SLOTS)).toBe(
      'Ce créneau n’est pas prévu pour cette ligne (créneaux prévus : Nuit (20 h – 4 h)). La saisie est conservée.',
    )
  })

  it('énumère plusieurs créneaux dans l’ordre reçu', () => {
    expect(phraseCreneauNonPrevu(['matin', 'nuit'], SLOTS)).toBe(
      'Ce créneau n’est pas prévu pour cette ligne (créneaux prévus : Matin, Nuit (20 h – 4 h)). La saisie est conservée.',
    )
  })

  // Un créneau peut avoir été retiré des réglages après la saisie : son
  // libellé n'existe plus nulle part. Le message retombe sur l'identifiant
  // plutôt que de s'effacer ou d'afficher « undefined ».
  it('retombe sur l’identifiant quand le créneau a été supprimé des réglages', () => {
    expect(phraseCreneauNonPrevu(['soiree-disparue'], SLOTS)).toBe(
      'Ce créneau n’est pas prévu pour cette ligne (créneaux prévus : soiree-disparue). La saisie est conservée.',
    )
    expect(phraseCreneauNonPrevu(['soiree-disparue'], SLOTS)).not.toMatch(/undefined/)
  })

  it('mélange un créneau connu et un créneau disparu sans rien perdre', () => {
    expect(phraseCreneauNonPrevu(['matin', 'disparu'], SLOTS)).toBe(
      'Ce créneau n’est pas prévu pour cette ligne (créneaux prévus : Matin, disparu). La saisie est conservée.',
    )
  })
})
