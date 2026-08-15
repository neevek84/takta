import type { TimeEntryKind } from '../types'
import { minutesToCentiemes } from '../time/units'

export interface EngagementSummary {
  venduCentiemes: number
  realiseCentiemes: number
  prevuCentiemes: number
  resteCentiemes: number
  depassementCentiemes: number
}

export function computeEngagement(args: {
  venduCentiemes: number
  entries: ReadonlyArray<{ kind: TimeEntryKind; minutes: number }>
  minutesParJour: number
}): EngagementSummary {
  let realiseMinutes = 0
  let prevuMinutes = 0

  for (const e of args.entries) {
    if (e.kind === 'REALISE') realiseMinutes += e.minutes
    else prevuMinutes += e.minutes
  }

  const realiseCentiemes = minutesToCentiemes(realiseMinutes, args.minutesParJour)
  const prevuCentiemes = minutesToCentiemes(prevuMinutes, args.minutesParJour)
  const solde = args.venduCentiemes - realiseCentiemes - prevuCentiemes

  return {
    venduCentiemes: args.venduCentiemes,
    realiseCentiemes,
    prevuCentiemes,
    resteCentiemes: Math.max(0, solde),
    depassementCentiemes: Math.max(0, -solde),
  }
}
