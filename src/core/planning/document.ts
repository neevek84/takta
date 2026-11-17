import { frenchHolidays } from '../calendar/holidays-fr'
import { joursDuMois } from '../cra/document'
import { moisDeLaPeriode, type Periode } from './periode'

/**
 * Le planning d'intervention : ce que le client lit pour savoir **quand** le
 * consultant est là, sur une période choisie.
 *
 * À la différence du CRA, ce document ne distingue pas le réalisé du
 * prévisionnel et ne porte ni jours vendus ni reste : il répond à « quels
 * jours ? », pas à « combien en reste-t-il ? ». Les quantités internes
 * n'ont rien à y faire.
 *
 * Tout se compte en **centièmes de jour** : additionner des 0,5 en flottant
 * finit toujours par afficher « 2,4999 ».
 */

/** Une saisie, réduite à ce que le planning en lit. */
export interface PlanningSaisie {
  /** 'YYYY-MM-DD' */
  date: string
  minutes: number
  /** la durée d'une journée figée à l'écriture de la saisie */
  minutesParJour: number
  /** début du bloc, minutes depuis minuit */
  startMinute: number
}

/** Une demi-journée qu'on sait placer, ou rien. */
export type Moment = 'MATIN' | 'APRES_MIDI' | null

export interface PlanningJour {
  /** 'YYYY-MM-DD' */
  date: string
  /** centièmes de jour posés ce jour-là, toutes saisies confondues */
  centiemes: number
  /** pour une demi-journée seulement : le moment, s'il est sans ambiguïté */
  moment: Moment
}

export interface PlanningMois {
  /** 'YYYY-MM' */
  mois: string
  centiemes: number
}

export interface PlanningDocument {
  clientNom: string
  missionLabel: string
  /** vide quand le planning couvre toute la mission */
  prestationLabel: string
  periode: Periode
  /** 'YYYY-MM-DD', la date d'édition imprimée en pied de page */
  editeLe: string
  mois: PlanningMois[]
  /** les seuls jours qui portent du temps, indexés par date */
  jours: Record<string, PlanningJour>
  /** les fériés des années touchées, indexés par date */
  feries: Record<string, string>
  centiemes: number
}

export interface PlanningInput {
  clientNom: string
  missionLabel: string
  prestationLabel: string
  periode: Periode
  editeLe: string
  saisies: ReadonlyArray<PlanningSaisie>
}

/** Midi : un bloc qui commence avant est du matin, à partir de là de l'après-midi. */
const MIDI = 12 * 60

function centiemesDe(saisie: PlanningSaisie): number {
  if (saisie.minutesParJour <= 0) return 0
  return Math.round((saisie.minutes / saisie.minutesParJour) * 100)
}

export function buildPlanningDocument(input: PlanningInput): PlanningDocument {
  const { du, au } = input.periode
  const parDate = new Map<string, PlanningSaisie[]>()

  for (const saisie of input.saisies) {
    // Les bornes sont incluses ; tout ce qui déborde est ignoré plutôt que
    // dessiné hors de la période annoncée en tête de page.
    if (saisie.date < du || saisie.date > au) continue
    if (centiemesDe(saisie) <= 0) continue
    const liste = parDate.get(saisie.date) ?? []
    liste.push(saisie)
    parDate.set(saisie.date, liste)
  }

  const jours: Record<string, PlanningJour> = {}
  for (const [date, saisies] of parDate) {
    const centiemes = saisies.reduce((somme, s) => somme + centiemesDe(s), 0)
    let moment: Moment = null
    if (centiemes === 50) {
      // Une demi-journée ne se dit « matin » que si **toutes** ses saisies
      // commencent le matin — deux quarts, l'un à 9 h et l'autre à 14 h, ne
      // sont ni l'un ni l'autre.
      if (saisies.every((s) => s.startMinute < MIDI)) moment = 'MATIN'
      else if (saisies.every((s) => s.startMinute >= MIDI)) moment = 'APRES_MIDI'
    }
    jours[date] = { date, centiemes, moment }
  }

  const mois = moisDeLaPeriode(input.periode).map((m) => ({
    mois: m,
    centiemes: joursDuMois(m).reduce((somme, d) => somme + (jours[d]?.centiemes ?? 0), 0),
  }))

  const feries: Record<string, string> = {}
  const annees = new Set(mois.map((m) => Number(m.mois.slice(0, 4))))
  for (const annee of annees) {
    for (const f of frenchHolidays(annee)) feries[f.date] = f.label
  }

  return {
    clientNom: input.clientNom,
    missionLabel: input.missionLabel,
    prestationLabel: input.prestationLabel,
    periode: input.periode,
    editeLe: input.editeLe,
    mois,
    jours,
    feries,
    centiemes: mois.reduce((somme, m) => somme + m.centiemes, 0),
  }
}

/** 250 → '2,5' ; 800 → '8' ; 25 → '0,25'. Sans zéros de traîne : c'est un planning, pas une facture. */
export function joursLisibles(centiemes: number): string {
  const texte = (centiemes / 100).toFixed(2).replace(/\.?0+$/, '')
  return texte.replace('.', ',')
}
