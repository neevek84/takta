/**
 * Comment une source d'engagement se dit à l'écran.
 *
 * Pur : aucune base, aucun réseau.
 *
 * **Pourquoi ce module existe.** La source était traduite par un ternaire posé
 * dans la page des missions : « propale Dolibarr » d'un côté, « saisi ici » de
 * l'autre. Le jour où une troisième source est apparue — la commande — elle
 * s'est mise à s'afficher « saisi ici », c'est-à-dire le contraire de ce
 * qu'elle est, sur le chiffre qui sera facturé. Un ternaire ne se met pas à
 * jour tout seul ; une table exhaustive, si — le typage refuse d'y laisser un
 * trou.
 */
import type { EngagementSource } from '@/core/types'

const LIBELLES: Record<EngagementSource, string> = {
  MANUEL: 'saisi ici',
  DOLIBARR_PROPALE: 'propale Dolibarr',
  DOLIBARR_COMMANDE: 'commande Dolibarr',
  DOLIBARR_PROJET: 'projet Dolibarr',
}

/** D'où vient l'engagement d'une prestation, en toutes lettres. */
export function libelleEngagement(source: EngagementSource): string {
  return LIBELLES[source]
}
