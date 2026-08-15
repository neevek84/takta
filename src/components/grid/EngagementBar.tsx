'use client'

import { computeEngagement } from '@/core/engagement/compute'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals } from '@/services/time-entries'

/**
 * Bandeau d'engagement d'une ligne de prestation.
 *
 * `totals` est un cumul **sur toute la durée de la ligne**, jamais les saisies
 * du seul mois affiché : l'engagement se consomme d'un mois sur l'autre, et le
 * comparer aux jours vendus du contrat entier n'a de sens qu'à ce prix.
 */
export function EngagementBar({
  line,
  totals,
}: {
  line: LineForGrid
  totals: LineEngagementTotals
}) {
  const e = computeEngagement({
    venduCentiemes: line.soldCentiemes,
    entries: [
      { kind: 'REALISE', minutes: totals.realiseMinutes },
      { kind: 'PREVISIONNEL', minutes: totals.prevuMinutes },
    ],
    minutesParJour: line.minutesParJour,
  })

  const pct = (v: number) => (e.venduCentiemes === 0 ? 0 : (v / e.venduCentiemes) * 100)

  return (
    <div data-testid={`engagement-${line.id}`} className="flex items-center gap-3 text-xs">
      <div className="h-2 w-40 overflow-hidden rounded bg-slate-200">
        <div className="flex h-full">
          <div className="bg-slate-800" style={{ width: `${pct(e.realiseCentiemes)}%` }} />
          <div className="bg-slate-400" style={{ width: `${pct(e.prevuCentiemes)}%` }} />
        </div>
      </div>
      <span className="text-slate-600">
        {e.venduCentiemes / 100} vendus · {e.realiseCentiemes / 100} réalisés ·{' '}
        {e.prevuCentiemes / 100} prévus · {e.resteCentiemes / 100} restants
      </span>
      {e.depassementCentiemes > 0 && (
        <span className="text-amber-600">dépassement de {e.depassementCentiemes / 100} j</span>
      )}
    </div>
  )
}
