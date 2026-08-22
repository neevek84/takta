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

/**
 * Les mêmes sources, telles qu'un menu déroulant les propose.
 *
 * **Pourquoi une seconde table, et pourquoi ici.** Les deux registres diffèrent
 * pour de bon : `libelleEngagement` s'insère dans une phrase — « Engagement :
 * saisi ici » — quand un choix de menu se lit seul et prend la majuscule. Ce
 * qui ne doit pas différer, c'est l'endroit où on les tient. Une table de
 * libellés recopiée dans un écran a déjà produit le défaut que ce module
 * existe pour empêcher : posée dans le formulaire des réglages en
 * `Record<string, string>`, elle a survécu à l'arrivée de la commande sans que
 * le typage bronche, et le menu affichait **une ligne vide** — sélectionnable,
 * et sans rien dire de ce qu'elle engageait.
 */
const LIBELLES_CHOIX: Record<EngagementSource, string> = {
  MANUEL: 'Manuel',
  DOLIBARR_PROPALE: 'Propale Dolibarr',
  DOLIBARR_COMMANDE: 'Commande Dolibarr',
  DOLIBARR_PROJET: 'Projet Dolibarr',
}

/** La source telle qu'un menu déroulant la propose. */
export function libelleChoixEngagement(source: EngagementSource): string {
  return LIBELLES_CHOIX[source]
}

/**
 * Les sources dont Dolibarr reste maître : jours vendus et TJM ne se modifient
 * pas ici.
 *
 * **Le trou que cette table ferme.** Le verrou était écrit
 * `source === 'DOLIBARR_PROPALE'`, à deux endroits — le service et le
 * formulaire. Le jour où la reprise depuis une **commande** est arrivée, la
 * comparaison est restée vraie pour la propale seule : une prestation reprise
 * d'une commande redevenait modifiable localement, et ses jours vendus
 * pouvaient diverger de la commande sans que rien ne le dise. Ce sont les
 * chiffres qui seront facturés.
 *
 * Un `Record` exhaustif oblige toute source future à déclarer sa réponse.
 */
const VERROUILLEES: Record<EngagementSource, boolean> = {
  MANUEL: false,
  DOLIBARR_PROPALE: true,
  DOLIBARR_COMMANDE: true,
  DOLIBARR_PROJET: true,
}

/** L'engagement de cette prestation est-il détenu par Dolibarr ? */
export function engagementVerrouille(source: EngagementSource): boolean {
  return VERROUILLEES[source]
}
