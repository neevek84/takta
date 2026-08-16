import type { CapacityMode } from '../types'
import {
  centiemesParFacteur,
  millicentiemesParFacteur,
  MILLICENTIEMES_PAR_CENTIEME,
  type MinutesAuFacteur,
} from '../time/units'

export type CapacityVerdict =
  | { ok: true }
  | { ok: false; severity: 'warn' | 'block'; totalCentiemes: number; capacityCentiemes: number }

/**
 * La journée dépasse-t-elle la capacité ? **À la minute près.**
 *
 * Le seuil est comparé dans l'unité où il est réglé (`capacityCentiemes`) : il
 * n'est jamais converti, il n'y a donc aucun facteur à lui choisir. Les
 * saisies, elles, arrivent ventilées — jamais en somme déjà écrasée — parce
 * que chacune porte le facteur figé à son écriture : additionner des minutes
 * issues de facteurs différents reviendrait à additionner des devises au taux
 * du jour de chacune.
 *
 * La comparaison se fait au millicentième, pas au centième. Arrondir au
 * centième *avant* de comparer laissait passer près de deux minutes et demie
 * de dépassement à 480 minutes par jour : la perte venait de l'arrondi
 * prématuré, jamais de l'unité commune. Le centième reste la bonne unité pour
 * *afficher* un nombre de jours, ce que fait le verdict ci-dessous ; il n'a
 * aucune raison d'être la finesse de la comparaison.
 *
 * Cette fonction est le seul juge du dépassement dans l'application : la ligne
 * de totaux de la grille s'en sert aussi, pour que son « ! » ne puisse jamais
 * contredire le service sur la même journée.
 */
export function depasseCapacite(
  entries: ReadonlyArray<MinutesAuFacteur>,
  capacityCentiemes: number,
): boolean {
  return (
    millicentiemesParFacteur(entries) > capacityCentiemes * MILLICENTIEMES_PAR_CENTIEME
  )
}

/**
 * Contrôle de la charge d'une journée.
 *
 * Le dépassement se juge à la minute près (voir `depasseCapacite`) ; le
 * verdict, lui, expose des **centièmes de jour**, l'unité que l'affichage sait
 * lire et celle qu'emploient déjà l'engagement, la charge et la ligne de
 * totaux. Un dépassement de moins d'un demi-centième est donc signalé avec un
 * total qui, arrondi, égale la capacité : le marqueur dit le vrai, le chiffre
 * dit ce qui s'affiche partout ailleurs.
 */
export function checkCapacity(args: {
  existing: ReadonlyArray<MinutesAuFacteur>
  added: ReadonlyArray<MinutesAuFacteur>
  capacityCentiemes: number
  mode: CapacityMode
}): CapacityVerdict {
  if (args.mode === 'DESACTIVE') return { ok: true }

  // Existant et ajout sont groupés ensemble : deux saisies du même facteur
  // cumulent leurs minutes avant conversion, qu'elles soient déjà en base ou
  // sur le point d'y entrer.
  const saisies = [...args.existing, ...args.added]
  if (!depasseCapacite(saisies, args.capacityCentiemes)) return { ok: true }

  return {
    ok: false,
    severity: args.mode === 'BLOCAGE' ? 'block' : 'warn',
    totalCentiemes: centiemesParFacteur(saisies),
    capacityCentiemes: args.capacityCentiemes,
  }
}
