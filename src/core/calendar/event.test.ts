import { describe, it, expect } from 'vitest'
import { entryBounds, type Slot } from '../time/slots'
import { buildCalendarEvent, COULEUR_PREVISIONNEL, COULEUR_REALISE } from './event'

const MATIN: Slot = { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 }
const APRES_MIDI: Slot = {
  id: 'apres-midi',
  label: 'Après-midi',
  startMinute: 840,
  endMinute: 1080,
  centiemes: 50,
}
const NUIT: Slot = { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 }

function base() {
  return {
    entryId: 'entry-1',
    date: '2026-03-10',
    kind: 'REALISE' as const,
    clientName: 'Acme',
    missionLabel: 'Refonte',
    lineLabel: 'Développement',
    // Les bornes que la saisie **porte**, figées à son écriture. Le calcul qui
    // les produit vit chez l'écrivain (`entryBounds`, éprouvé dans
    // `core/time/slots.test.ts`) : le reconstruire ici reviendrait à laisser
    // le lecteur recalculer des horaires, ce qui déplaçait des journées déjà
    // saisies dès qu'un créneau changeait en administration.
    startMinute: 540,
    endMinute: 1020,
    timeZone: 'Europe/Paris',
  }
}

/** Ce que le chemin d'écriture aurait figé — pour lire les cas ci-dessous. */
function bornes(minutes: number, slot: Slot | null) {
  return entryBounds({
    minutes,
    slot,
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
  })
}

describe('buildCalendarEvent — sans créneau', () => {
  it('démarre à la borne de début et dure jusqu à la borne de fin', () => {
    const e = buildCalendarEvent({ ...base(), ...bornes(480, null) })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T17:00:00'])
  })

  it('couvre la plage entière quand la journée vaut la plage', () => {
    const e = buildCalendarEvent({ ...base(), ...bornes(540, null) })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T18:00:00'])
  })

  it('place une demi-journée sur la première moitié', () => {
    const e = buildCalendarEvent({ ...base(), ...bornes(240, null) })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T13:00:00'])
  })

  it('place trois heures sur les trois premières heures', () => {
    const e = buildCalendarEvent({ ...base(), ...bornes(180, null) })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T12:00:00'])
  })

  it('ne déborde jamais de la plage', () => {
    // Un bloc d'occupation qui filerait jusqu'à 20 h occuperait une soirée que
    // personne n'a vendue.
    const e = buildCalendarEvent({ ...base(), ...bornes(660, null) })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T18:00:00'])
  })

  it('suit une plage journée décalée', () => {
    const e = buildCalendarEvent({
      ...base(),
      ...entryBounds({
        minutes: 240,
        slot: null,
        journeeDebutMinute: 480,
        journeeFinMinute: 960,
      }),
    })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T08:00:00', '2026-03-10T12:00:00'])
  })

  it('ferme la journée à minuit sans se replier sur la veille', () => {
    const e = buildCalendarEvent({
      ...base(),
      ...entryBounds({
        minutes: 900,
        slot: null,
        journeeDebutMinute: 540,
        journeeFinMinute: 1440,
      }),
    })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-11T00:00:00'])
  })
})

describe('buildCalendarEvent — avec créneau', () => {
  it('prend les bornes du créneau, pas la plage par défaut', () => {
    const e = buildCalendarEvent({ ...base(), ...bornes(240, APRES_MIDI) })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T14:00:00', '2026-03-10T18:00:00'])
  })

  it('couvre le matin', () => {
    const e = buildCalendarEvent({ ...base(), ...bornes(240, MATIN) })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T13:00:00'])
  })

  it('franchit minuit sans se replier sur lui-même', () => {
    const e = buildCalendarEvent({ ...base(), ...bornes(480, NUIT) })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T22:00:00', '2026-03-11T06:00:00'])
  })

  it('ignore la durée saisie quand un créneau est choisi', () => {
    // Le créneau dit quand ; la durée saisie sert au CRA, pas à l'agenda.
    const court = buildCalendarEvent({ ...base(), ...bornes(60, APRES_MIDI) })
    expect([court.startLocal, court.endLocal]).toEqual([
      '2026-03-10T14:00:00',
      '2026-03-10T18:00:00',
    ])
  })

  // Le cœur du gel : le constructeur ne connaît plus ni les créneaux ni la
  // plage journée. Redéfinir « Matin » en administration ne peut donc plus
  // déplacer un bloc déjà écrit, quel que soit le lecteur.
  it('ne consulte aucun réglage : deux bornes suffisent à le construire', () => {
    const e = buildCalendarEvent({ ...base(), startMinute: 615, endMinute: 735 })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T10:15:00', '2026-03-10T12:15:00'])
  })
})

describe('buildCalendarEvent — le reste de l événement', () => {
  it('titre le bloc client · mission · ligne', () => {
    expect(buildCalendarEvent(base()).summary).toBe('Acme · Refonte · Développement')
  })

  it('marque le bloc occupé', () => {
    expect(buildCalendarEvent(base()).transparency).toBe('opaque')
  })

  it('distingue le réalisé du prévisionnel par la couleur', () => {
    expect(buildCalendarEvent(base()).colorId).toBe(COULEUR_REALISE)
    expect(buildCalendarEvent({ ...base(), kind: 'PREVISIONNEL' }).colorId).toBe(
      COULEUR_PREVISIONNEL,
    )
    expect(COULEUR_REALISE).not.toBe(COULEUR_PREVISIONNEL)
  })

  it('porte l identifiant de la saisie, qui permet de retrouver les orphelins', () => {
    expect(buildCalendarEvent(base()).craEntryId).toBe('entry-1')
  })

  it('reporte le fuseau tel quel', () => {
    expect(buildCalendarEvent({ ...base(), timeZone: 'Indian/Reunion' }).timeZone).toBe(
      'Indian/Reunion',
    )
  })

  it('dit dans la description que la saisie fait foi', () => {
    expect(buildCalendarEvent(base()).description).toContain('la saisie fait foi')
    expect(buildCalendarEvent({ ...base(), kind: 'PREVISIONNEL' }).description).toContain(
      'prévisionnel',
    )
  })
})
