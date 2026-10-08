/**
 * La clé d'un verrou de saisie : une prestation sur un mois.
 *
 * Le verrou se décide par (mission, mois) dans les services — `isLocked` sur
 * le statut du CRA —, mais la grille raisonne par ligne : le service déplie
 * donc chaque mission verrouillée sur ses lignes, et la grille relit la même
 * clé. L'écrire à un seul endroit empêche les deux bouts de diverger sur le
 * séparateur.
 */
export function cleVerrou(lineId: string, mois: string): string {
  return `${lineId}|${mois}`
}

/** Le mois 'YYYY-MM' d'une date 'YYYY-MM-DD'. */
export function moisDe(date: string): string {
  return date.slice(0, 7)
}
