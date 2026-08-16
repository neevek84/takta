import { describe, it, expect } from 'vitest'
import {
  libelleCreneauAvecMoment,
  libelleDemiJournee,
  libelleDemiJourneeDetaille,
  momentDeJournee,
  phraseCreneauNonPrevu,
} from './slot-labels'
import type { Slot } from '../time/slots'

const SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'nuit', label: 'Nuit (20 h – 4 h)', startMinute: 1200, endMinute: 240, centiemes: 50 },
]

const MATIN = SLOTS[0]!
const NUIT = SLOTS[1]!
const APRES_MIDI: Slot = {
  id: 'apres-midi',
  label: 'Après-midi',
  startMinute: 840,
  endMinute: 1080,
  centiemes: 50,
}

describe('momentDeJournee', () => {
  it('classe un créneau commencé avant midi en AM', () => {
    expect(momentDeJournee(MATIN)).toBe('AM')
  })

  it('classe un créneau commencé à midi ou après en PM', () => {
    expect(momentDeJournee(APRES_MIDI)).toBe('PM')
    expect(momentDeJournee({ ...MATIN, startMinute: 720 })).toBe('PM')
  })

  // Un créneau qui franchit minuit est des deux côtés de midi à la fois : il
  // n'a pas de moitié de journée, et le dessin de la case ne peut pas le
  // ranger d'un côté de la diagonale.
  it('ne range pas un créneau qui franchit minuit', () => {
    expect(momentDeJournee(NUIT)).toBeNull()
  })
})

describe('libelleDemiJournee', () => {
  // « ½ M » et « ½ A » se confondaient : les deux libellés commencent par la
  // même lettre pour qui lit vite, et « M » pouvait aussi bien être « Matin »
  // que « Midi ». AM et PM sont universels.
  it('abrège les deux moitiés de journée en ½ AM et ½ PM', () => {
    expect(libelleDemiJournee('matin', SLOTS)).toBe('½ AM')
    expect(libelleDemiJournee('apres-midi', [...SLOTS, APRES_MIDI])).toBe('½ PM')
  })

  it('garde le libellé réglé en administration pour un créneau sans moitié', () => {
    expect(libelleDemiJournee('nuit', SLOTS)).toBe('½ Nuit (20 h – 4 h)')
  })

  it('retombe sur l’identifiant quand le créneau a disparu des réglages', () => {
    expect(libelleDemiJournee('disparu', SLOTS)).toBe('½ disparu')
    expect(libelleDemiJournee('disparu', SLOTS)).not.toMatch(/undefined/)
  })
})

describe('libelleCreneauAvecMoment', () => {
  // Le formulaire de durée libre n'écrit pas forcément une demi-journée : on y
  // saisit trois heures sur le créneau du matin. Y afficher « ½ AM » dirait
  // une quantité que la saisie ne porte pas — l'abréviation y est donc une
  // précision du créneau, pas sa valeur.
  it('précise la moitié de journée sans annoncer une demi-journée', () => {
    expect(libelleCreneauAvecMoment('matin', SLOTS)).toBe('Matin (AM)')
    expect(libelleCreneauAvecMoment('apres-midi', [...SLOTS, APRES_MIDI])).toBe('Après-midi (PM)')
  })

  it('laisse tel quel un créneau sans moitié de journée', () => {
    expect(libelleCreneauAvecMoment('nuit', SLOTS)).toBe('Nuit (20 h – 4 h)')
  })

  it('retombe sur l’identifiant quand le créneau a disparu des réglages', () => {
    expect(libelleCreneauAvecMoment('disparu', SLOTS)).toBe('disparu')
  })
})

describe('libelleDemiJourneeDetaille', () => {
  // L'infobulle et le formulaire disent les deux : l'abréviation universelle
  // que le porteur veut voir partout, et le libellé réglé en administration
  // qui reste le nom du créneau dans les réglages.
  it('joint l’abréviation et le libellé réglé', () => {
    expect(libelleDemiJourneeDetaille('matin', SLOTS)).toBe('½ AM — Matin')
  })

  it('ne redit pas deux fois le même mot pour un créneau sans moitié', () => {
    expect(libelleDemiJourneeDetaille('nuit', SLOTS)).toBe('½ Nuit (20 h – 4 h)')
  })
})

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
