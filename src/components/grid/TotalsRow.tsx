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
    <tr className="border-t-2 font-medium">
      <th scope="row" className="sticky left-0 bg-white px-2 py-1 text-left text-sm">
        Total
      </th>
      {days.map((d) => {
        const minutes = totals.get(d.date) ?? 0
        const over = capacityMinutes > 0 && minutes > capacityMinutes
        return (
          <td
            key={d.date}
            data-testid={`total-${d.date}`}
            className={`px-1 py-1 text-center text-xs ${over ? 'text-red-600' : 'text-slate-600'}`}
          >
            {formatQuantity(minutes, 'JOUR', minutesParJour)}
          </td>
        )
      })}
    </tr>
  )
}
