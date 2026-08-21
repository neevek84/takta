import type { TimeEntryKind } from '../types'
import { minutesToCentiemes } from '../time/units'

/** Une saisie de temps, telle que le connecteur la reçoit du service. */
export interface PushableEntry {
  id: string
  lineId: string
  /** 'YYYY-MM-DD' */
  date: string
  /** chaîne vide = journée entière */
  slotId: string
  minutes: number
  kind: TimeEntryKind
  /** durée d'une journée figée à l'écriture de cette saisie (lot 1d) */
  minutesParJour: number
  comment: string
}

export interface TimeSpentPayload {
  entryId: string
  lineId: string
  date: string
  slotId: string
  /**
   * Durée écoulée, en secondes — l'unité de `llx_projet_task_time`.
   *
   * `minutes × 60`, et rien d'autre. Ni le réglage global, ni
   * `TIMESHEET_DAY_DURATION` n'entrent ici : `TimeEntry.minutes` est déjà une
   * durée écoulée, obtenue en multipliant les jours saisis par le facteur figé
   * de la ligne au moment de l'écriture.
   */
  durationSeconds: number
  /**
   * La même durée exprimée en jours, au facteur **figé de cette saisie**.
   *
   * C'est ce nombre qui sert de quantité sur une ligne de facture, et de point
   * de comparaison avec ce que Dolibarr affichera à partir des secondes.
   */
  centiemesDeJour: number
  note: string
}

/**
 * Traduit des saisies en lignes de temps passé pour Dolibarr.
 *
 * Ne laisse passer que le réalisé : du temps prévu n'est pas du temps consommé
 * et n'a rien à faire dans une facture (spec §2).
 */
export function buildTimeSpentPayloads(
  entries: ReadonlyArray<PushableEntry>,
): TimeSpentPayload[] {
  const out: TimeSpentPayload[] = []

  for (const e of entries) {
    if (e.kind !== 'REALISE') continue
    if (e.minutes <= 0) continue

    if (!Number.isInteger(e.minutesParJour) || e.minutesParJour <= 0) {
      throw new Error(
        `La saisie ${e.id} porte une durée de journée inexploitable (${e.minutesParJour}).`,
      )
    }

    out.push({
      entryId: e.id,
      lineId: e.lineId,
      date: e.date,
      slotId: e.slotId,
      durationSeconds: e.minutes * 60,
      // Une saisie, un facteur : la conversion se fait ici saisie par saisie,
      // sous le facteur figé à son écriture. Aucune somme de minutes ne
      // traverse ce module, donc aucun cumul ne peut mélanger deux facteurs.
      centiemesDeJour: minutesToCentiemes(e.minutes, e.minutesParJour),
      note: e.comment.trim(),
    })
  }

  // Ordre stable : un push rejoué produit la même séquence d'appels, ce qui
  // rend les journaux et les tests lisibles.
  out.sort((a, b) =>
    a.date === b.date
      ? a.lineId === b.lineId
        ? a.slotId.localeCompare(b.slotId)
        : a.lineId.localeCompare(b.lineId)
      : a.date.localeCompare(b.date),
  )

  return out
}

export interface DayLengthComparison {
  minutesParJourLocal: number
  minutesParJourDolibarr: number
  divergent: boolean
  /**
   * Ce que Dolibarr affichera pour une journée locale pleine, en centièmes de
   * jour. 114 quand l'application compte 8 h et Dolibarr 7 h.
   */
  centiemesAffichesParDolibarr: number
}

/**
 * Compare la durée d'une journée des deux côtés.
 *
 * Sert uniquement à **signaler** l'écart (spec §8) : rien dans ce module ne
 * compense l'écart en silence, ce serait la meilleure façon de le rendre
 * indétectable.
 */
export function compareDayLength(args: {
  minutesParJourLocal: number
  heuresParJourDolibarr: number
}): DayLengthComparison {
  const minutesParJourDolibarr = Math.round(args.heuresParJourDolibarr * 60)

  if (!Number.isFinite(minutesParJourDolibarr) || minutesParJourDolibarr <= 0) {
    throw new Error(
      `La durée d'une journée relevée dans Dolibarr est inexploitable (${args.heuresParJourDolibarr} h).`,
    )
  }

  return {
    minutesParJourLocal: args.minutesParJourLocal,
    minutesParJourDolibarr,
    divergent: args.minutesParJourLocal !== minutesParJourDolibarr,
    centiemesAffichesParDolibarr: minutesToCentiemes(
      args.minutesParJourLocal,
      minutesParJourDolibarr,
    ),
  }
}

/**
 * La charge de travail prévue d'une tâche Dolibarr, **en secondes**, à partir
 * de ce que la prestation vend.
 *
 * **L'unité n'est pas négociable.** `llx_projet_task.planned_workload` est en
 * secondes : `projet/tasks/task.php` la compose en `heures × 3600 + minutes ×
 * 60` et la relit par `convertSecondToTime`. Y écrire des heures produirait une
 * charge 3 600 fois trop petite, que rien ne signalerait — la tâche afficherait
 * simplement « 0 h 00 » sur cinq jours vendus.
 *
 * **`null` n'est pas zéro.** Une prestation qui ne vend rien de chiffré a une
 * charge *inconnue*, pas une charge nulle ; Dolibarr distingue les deux et
 * laisse la colonne vide. Écrire `0` afficherait un avancement de 100 % dès la
 * première heure consommée.
 *
 * Le facteur est celui de la prestation, jamais une constante : une journée ne
 * vaut pas sept heures partout, et c'est déjà ce que respecte le push des
 * temps.
 */
export function chargePrevueEnSecondes(args: {
  /** jours vendus, en centièmes de jour */
  soldCentiemes: number
  /** durée d'une journée, en minutes */
  minutesParJour: number
}): number | null {
  if (args.soldCentiemes <= 0) return null
  if (!Number.isFinite(args.minutesParJour) || args.minutesParJour <= 0) return null

  return Math.round((args.soldCentiemes / 100) * args.minutesParJour * 60)
}
