import type { TimeEntryKind } from '../types'
import { minutesToCentiemes } from '../time/units'

export interface EngagementSummary {
  venduCentiemes: number
  realiseCentiemes: number
  prevuCentiemes: number
  resteCentiemes: number
  depassementCentiemes: number
}

/**
 * Cumule les minutes avant de convertir — mais seulement à facteur constant :
 * des minutes converties à 420/jour et à 480/jour ne s'additionnent pas.
 */
function centiemesParFacteur(
  entries: ReadonlyArray<{ minutes: number; minutesParJour: number }>,
): number {
  const parFacteur = new Map<number, number>()
  for (const e of entries) {
    parFacteur.set(e.minutesParJour, (parFacteur.get(e.minutesParJour) ?? 0) + e.minutes)
  }

  let centiemes = 0
  for (const [facteur, minutes] of parFacteur) {
    centiemes += minutesToCentiemes(minutes, facteur)
  }
  return centiemes
}

export function computeEngagement(args: {
  venduCentiemes: number
  entries: ReadonlyArray<{ kind: TimeEntryKind; minutes: number; minutesParJour: number }>
}): EngagementSummary {
  const realiseCentiemes = centiemesParFacteur(args.entries.filter((e) => e.kind === 'REALISE'))
  const prevuCentiemes = centiemesParFacteur(args.entries.filter((e) => e.kind === 'PREVISIONNEL'))
  const solde = args.venduCentiemes - realiseCentiemes - prevuCentiemes

  return {
    venduCentiemes: args.venduCentiemes,
    realiseCentiemes,
    prevuCentiemes,
    resteCentiemes: Math.max(0, solde),
    depassementCentiemes: Math.max(0, -solde),
  }
}
