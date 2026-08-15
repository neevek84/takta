import type { MonthDay } from './build'

/**
 * Découpe un mois en semaines de sept cases, lundi en tête.
 *
 * Les cases hors du mois valent `null` plutôt que d'être omises : sept
 * colonnes en toutes circonstances est ce qui fait tenir la vue sur un
 * téléphone, et une semaine plus courte que les autres briserait l'alignement
 * des jours sur leur colonne.
 */
export function buildWeeks(days: readonly MonthDay[]): Array<Array<MonthDay | null>> {
  const premier = days[0]
  if (premier === undefined) return []

  const semaines: Array<Array<MonthDay | null>> = []
  let courante: Array<MonthDay | null> = Array<MonthDay | null>(premier.dayOfWeek - 1).fill(null)

  for (const jour of days) {
    courante.push(jour)
    if (jour.dayOfWeek === 7) {
      semaines.push(courante)
      courante = []
    }
  }

  if (courante.length > 0) {
    while (courante.length < 7) courante.push(null)
    semaines.push(courante)
  }

  return semaines
}
