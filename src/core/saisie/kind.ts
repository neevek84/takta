import type { TimeEntryKind } from '../types'

/**
 * Le `kind` sous lequel une journée se lit, à partir de celui de ses saisies.
 *
 * **La règle, une fois pour toutes : le prévisionnel l'emporte.** Une journée
 * dont une seule saisie est prévisionnelle se lit comme prévisionnelle.
 *
 * Pourquoi ce sens plutôt que l'autre : le prévisionnel échu ne devient
 * réalisé que par un geste explicite (`PastForecastNotice`, puis
 * `validerJoursPasses`). Lire une journée mixte comme réalisée effacerait de
 * l'écran la seule trace de la conversion qui reste à faire — l'utilisateur
 * croirait sa journée acquise alors qu'une part est encore une prévision.
 * L'inverse ne coûte qu'un signal en trop, que la conversion retire.
 *
 * Le calendrier et le tableau consomment cette fonction tous les deux : c'est
 * ce qui empêche deux vues du même mois d'afficher deux natures pour le même
 * jour. Une journée sans saisie n'a rien à convertir : elle est réalisée par
 * défaut, et les deux vues la traitent de toute façon comme vide.
 */
export function kindDeLaJournee(kinds: readonly TimeEntryKind[]): TimeEntryKind {
  return kinds.some((k) => k === 'PREVISIONNEL') ? 'PREVISIONNEL' : 'REALISE'
}
