/**
 * La règle de conversion d'une ligne de **propale** Dolibarr en engagement
 * local.
 *
 * L'implémentation vit dans `./ligne-vendue.ts`, partagée avec les lignes de
 * commande : la règle est la même, et deux copies auraient fini par diverger
 * sur l'arrondi — c'est le nombre de jours facturés qui en dépend. Ce module
 * reste le nom sous lequel la reprise de propale l'appelle.
 */
import { reprendreLigneVendue, type RepriseLigneVendue } from './ligne-vendue'

/** Ce qu'une ligne de propale devient localement, en entiers. */
export type RepriseLignePropale = RepriseLigneVendue

/**
 * Convertit une ligne de propale en jours vendus et TJM locaux.
 *
 * **Le facteur de conversion d'une journée (`minutesParJour`) n'intervient
 * pas.** Une propale vend des jours ; `soldCentiemes` compte des centièmes de
 * jour, pas des minutes.
 */
export function reprendreLignePropale(ligne: {
  /** quantité vendue, en jours */
  qty: number
  /** prix unitaire, en centimes */
  subpriceCents: number
}): RepriseLignePropale {
  return reprendreLigneVendue(ligne, 'propale')
}
