import type { CapacityMode } from '../types'
import { centiemesParFacteur, type MinutesAuFacteur } from '../time/units'

export type CapacityVerdict =
  | { ok: true }
  | { ok: false; severity: 'warn' | 'block'; totalCentiemes: number; capacityCentiemes: number }

/**
 * Contrôle de la charge d'une journée, **en centièmes de jour**.
 *
 * Le seuil est comparé dans l'unité où il est réglé (`capacityCentiemes`), et
 * n'est donc jamais converti : il n'y a aucun facteur à lui choisir. Les
 * saisies, elles, arrivent ventilées — jamais en somme déjà écrasée — parce
 * que chacune porte le facteur figé à son écriture : additionner des minutes
 * issues de facteurs différents reviendrait à additionner des devises au taux
 * du jour de chacune.
 *
 * Conséquence assumée du passage aux centièmes : la comparaison a la finesse
 * du centième de jour. Une minute au-delà de la capacité s'arrondit au même
 * centième et passe ; c'est le prix de la seule unité dans laquelle la
 * capacité et les saisies sont comparables.
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
  const totalCentiemes = centiemesParFacteur([...args.existing, ...args.added])
  if (totalCentiemes <= args.capacityCentiemes) return { ok: true }

  return {
    ok: false,
    severity: args.mode === 'BLOCAGE' ? 'block' : 'warn',
    totalCentiemes,
    capacityCentiemes: args.capacityCentiemes,
  }
}
