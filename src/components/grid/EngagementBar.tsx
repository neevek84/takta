'use client'

import { computeEngagement } from '@/core/engagement/compute'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'

export function EngagementBar({
  line,
  entries,
}: {
  line: LineForGrid
  entries: MonthEntry[]
}) {
  const e = computeEngagement({
    venduCentiemes: line.soldCentiemes,
    entries: entries.filter((x) => x.lineId === line.id),
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
