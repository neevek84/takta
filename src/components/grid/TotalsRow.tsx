'use client'

import { dailyTotals } from '@/core/month/build'
import { formatQuantity } from '@/core/time/units'
import type { MonthDay } from '@/core/month/build'
import type { MonthEntry } from '@/services/time-entries'

export function TotalsRow({
  days,
  entries,
  capacityMinutes,
  minutesParJour,
}: {
  days: MonthDay[]
  entries: MonthEntry[]
  capacityMinutes: number
  minutesParJour: number
}) {
  const totals = dailyTotals(entries)

  return (
    <tr className="border-t-2 border-rule font-medium">
      <th scope="row" className="sticky left-0 bg-surface px-2 py-1 text-left text-sm">
        Total
      </th>
      {days.map((d) => {
        const minutes = totals.get(d.date) ?? 0
        const over = capacityMinutes > 0 && minutes > capacityMinutes
        return (
          // Le dépassement porte trois signaux — teinte, graisse soulignée et
          // glyphe — dont deux survivent à une vision monochrome.
          <td
            key={d.date}
            data-testid={`total-${d.date}`}
            data-depassement={over ? 'true' : 'false'}
            title={over ? 'Capacité dépassée' : undefined}
            className={`px-1 py-1 text-center text-xs ${
              over ? 'font-bold text-danger-ink underline decoration-2' : 'text-muted'
            }`}
          >
            {over && <span aria-hidden="true">! </span>}
            {formatQuantity(minutes, 'JOUR', minutesParJour)}
          </td>
        )
      })}
    </tr>
  )
}
