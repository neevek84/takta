import { describe, it, expect } from 'vitest'
import {
  dernierJourDuMoisPrecedent,
  minutesDepuisMinuitLocal,
  placerLesCreneaux,
  MINUTE_PAR_DEFAUT,
} from './reprise-temps'

describe('dernierJourDuMoisPrecedent', () => {
  it('rend le dernier jour du mois qui précède', () => {
    expect(dernierJourDuMoisPrecedent('2026-08-21')).toBe('2026-07-31')
  })

  // Février compte 28 jours, sauf tous les quatre ans. Une borne fausse d'un
  // jour laisserait un temps hors reprise, ou en ferait entrer un de trop.
  it('sait que février est court, et bissextile de temps en temps', () => {
    expect(dernierJourDuMoisPrecedent('2026-03-15')).toBe('2026-02-28')
    expect(dernierJourDuMoisPrecedent('2028-03-01')).toBe('2028-02-29')
  })

  it("recule d'une année en janvier", () => {
    expect(dernierJourDuMoisPrecedent('2026-01-07')).toBe('2025-12-31')
  })
})

describe('minutesDepuisMinuitLocal', () => {
  // Mesuré sur l'instance du porteur : un temps affiché 7 h à Paris revient
  // à 1 763 100 000, soit 6 h GMT. Lire l'heure en UTC décalerait la reprise.
  it("rend l'heure locale, pas celle de GMT", () => {
    expect(minutesDepuisMinuitLocal(1_763_100_000, 'Europe/Paris')).toBe(7 * 60)
    expect(minutesDepuisMinuitLocal(1_763_100_000, 'UTC')).toBe(6 * 60)
  })

  // Le décalage change au milieu de l'année : un import couvrant mars et
  // octobre ne peut pas se contenter d'un décalage constant.
  it("suit l'heure d'été", () => {
    // 2026-07-15 06:00 GMT = 08:00 à Paris (UTC+2).
    expect(minutesDepuisMinuitLocal(Date.parse('2026-07-15T06:00:00Z') / 1000, 'Europe/Paris')).toBe(
      8 * 60,
    )
    // 2026-01-15 06:00 GMT = 07:00 à Paris (UTC+1).
    expect(minutesDepuisMinuitLocal(Date.parse('2026-01-15T06:00:00Z') / 1000, 'Europe/Paris')).toBe(
      7 * 60,
    )
  })

  // « 24 h » est une minute hors journée, et la clé d'unicité la refuserait.
  it('rend zéro à minuit, jamais 1 440', () => {
    expect(minutesDepuisMinuitLocal(Date.parse('2026-07-15T00:00:00Z') / 1000, 'UTC')).toBe(0)
  })
})

describe('placerLesCreneaux', () => {
  it("garde l'heure que Dolibarr porte", () => {
    expect(placerLesCreneaux([{ minuteProposee: 7 * 60, durationSeconds: 12_600 }])).toEqual([
      { startMinute: 420, endMinute: 630 },
    ])
  })

  it('pose à 9 h ce que Dolibarr ne situe pas', () => {
    expect(placerLesCreneaux([{ minuteProposee: null, durationSeconds: 3_600 }])).toEqual([
      { startMinute: MINUTE_PAR_DEFAUT, endMinute: 600 },
    ])
  })

  // La clé d'unicité porte l'heure de début : sans décalage, le second temps
  // remplacerait le premier au lieu de s'ajouter.
  it('décale le suivant à la fin du précédent, jamais d un pas fixe', () => {
    const creneaux = placerLesCreneaux([
      { minuteProposee: null, durationSeconds: 12_600 },
      { minuteProposee: null, durationSeconds: 3_600 },
    ])

    expect(creneaux).toEqual([
      { startMinute: 540, endMinute: 750 },
      // 3 h 30 après 9 h, et non 10 h : un pas d'une heure ferait se chevaucher
      // les deux blocs que l'écran dessine.
      { startMinute: 750, endMinute: 810 },
    ])
  })

  // Sans tri, un temps de 14 h traité avant un temps de 9 h repousserait
  // celui de 9 h après lui — et l'écran montrerait la journée à l'envers.
  it("place dans l'ordre des heures, pas dans celui de la liste", () => {
    const creneaux = placerLesCreneaux([
      { minuteProposee: 14 * 60, durationSeconds: 3_600 },
      { minuteProposee: 9 * 60, durationSeconds: 3_600 },
    ])

    expect(creneaux[0]!.startMinute).toBe(540)
    expect(creneaux[1]!.startMinute).toBe(840)
  })

  // Une reprise rejouée ne doit pas écraser ce qu'elle a posé la première fois.
  it('évite les minutes déjà occupées en base', () => {
    const creneaux = placerLesCreneaux([{ minuteProposee: 9 * 60, durationSeconds: 3_600 }], [540])

    expect(creneaux[0]!.startMinute).toBe(541)
  })

  // Une journée ne porte que 1 440 minutes. Déborder écrirait une fin
  // inférieure au début, que `minutesBetween` lit comme un passage de minuit.
  it('ne déborde jamais sur le lendemain', () => {
    const creneaux = placerLesCreneaux([
      { minuteProposee: 23 * 60, durationSeconds: 12_600 },
      { minuteProposee: 23 * 60, durationSeconds: 12_600 },
    ])

    for (const c of creneaux) {
      expect(c.startMinute).toBeLessThanOrEqual(1439)
      expect(c.endMinute).toBeLessThanOrEqual(1439)
    }
  })

  it('ne rend aucun créneau pour une liste vide', () => {
    expect(placerLesCreneaux([])).toEqual([])
  })
})
