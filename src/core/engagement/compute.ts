import type { TimeEntryKind } from '../types'
// Le groupement par facteur vit dans le module de conversion du domaine : le
// contrôle de capacité le consomme aussi, et deux copies de cette règle
// finiraient par diverger.
import { centiemesParFacteur } from '../time/units'

export interface EngagementSummary {
  venduCentiemes: number
  realiseCentiemes: number
  prevuCentiemes: number
  resteCentiemes: number
  depassementCentiemes: number
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
