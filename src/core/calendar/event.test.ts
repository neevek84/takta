import { describe, it, expect } from 'vitest'
import type { Slot } from '../time/slots'
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
    minutes: 480,
    kind: 'REALISE' as const,
    clientName: 'Acme',
    missionLabel: 'Refonte',
    lineLabel: 'Développement',
    slot: null as Slot | null,
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
    timeZone: 'Europe/Paris',
  }
}

describe('buildCalendarEvent — sans créneau', () => {
  it('démarre à la plage et dure exactement le temps saisi', () => {
    const e = buildCalendarEvent(base())
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T17:00:00'])
  })

  it('couvre la plage entière quand la journée vaut la plage', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 540 })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T18:00:00'])
  })

  it('place une demi-journée sur la première moitié', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 240 })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T13:00:00'])
  })

  it('place trois heures sur les trois premières heures', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 180 })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T12:00:00'])
  })

  it('ne déborde jamais de la plage', () => {
    // Un bloc d'occupation qui filerait jusqu'à 20 h occuperait une soirée que
    // personne n'a vendue.
    const e = buildCalendarEvent({ ...base(), minutes: 660 })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T18:00:00'])
  })

  it('suit une plage journée décalée', () => {
    const e = buildCalendarEvent({
      ...base(),
      minutes: 240,
      journeeDebutMinute: 480,
      journeeFinMinute: 960,
    })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T08:00:00', '2026-03-10T12:00:00'])
  })
})

describe('buildCalendarEvent — avec créneau', () => {
  it('prend les bornes du créneau, pas la plage par défaut', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 240, slot: APRES_MIDI })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T14:00:00', '2026-03-10T18:00:00'])
  })

  it('couvre le matin', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 240, slot: MATIN })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T09:00:00', '2026-03-10T13:00:00'])
  })

  it('franchit minuit sans se replier sur lui-même', () => {
    const e = buildCalendarEvent({ ...base(), minutes: 480, slot: NUIT })
    expect([e.startLocal, e.endLocal]).toEqual(['2026-03-10T22:00:00', '2026-03-11T06:00:00'])
  })

  it('ignore la durée saisie quand un créneau est choisi', () => {
    // Le créneau dit quand ; la durée saisie sert au CRA, pas à l'agenda.
    const court = buildCalendarEvent({ ...base(), minutes: 60, slot: APRES_MIDI })
    expect([court.startLocal, court.endLocal]).toEqual([
      '2026-03-10T14:00:00',
      '2026-03-10T18:00:00',
    ])
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
