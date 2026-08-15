'use client'

import { formatQuantity } from '@/core/time/units'
import type { MonthDay } from '@/core/month/build'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'
import { EngagementBar } from './EngagementBar'
import { TotalsRow } from './TotalsRow'

export function MonthGrid({
  days,
  lines,
  entries,
  capacityMinutes,
  onSave,
}: {
  days: MonthDay[]
  lines: LineForGrid[]
  entries: MonthEntry[]
  capacityMinutes: number
  onSave: (lineId: string, date: string, raw: string) => void
}) {
  const byKey = new Map(entries.map((e) => [`${e.lineId}|${e.date}`, e]))
  const minutesParJour = lines[0]?.minutesParJour ?? 480

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex flex-col gap-1">
        {lines.map((l) => (
          <EngagementBar key={l.id} line={l} entries={entries} />
        ))}
      </div>

      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-white px-2 py-1 text-left">
              Ligne
            </th>
            {days.map((d) => (
              <th
                key={d.date}
                scope="col"
                data-testid={`day-header-${d.date}`}
                className={`w-9 px-1 py-1 text-center text-xs font-normal ${
                  d.isWorking && !d.isHoliday ? '' : 'bg-slate-100'
                }`}
              >
                {Number(d.date.slice(8))}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t">
              <th scope="row" className="sticky left-0 bg-white px-2 py-1 text-left font-normal">
                {l.label}
              </th>
              {days.map((d) => {
                const entry = byKey.get(`${l.id}|${d.date}`)
                const value = entry ? formatQuantity(entry.minutes, l.displayUnit, l.minutesParJour) : ''
                return (
                  <td key={d.date} className={d.isWorking && !d.isHoliday ? '' : 'bg-slate-50'}>
                    <input
                      aria-label={`${l.label} ${d.date}`}
                      defaultValue={value}
                      onBlur={(ev) => onSave(l.id, d.date, ev.target.value)}
                      className={`h-8 w-9 border-0 bg-transparent text-center text-xs outline-none focus:bg-blue-50 ${
                        entry?.kind === 'PREVISIONNEL' ? 'text-slate-400 italic' : ''
                      }`}
                    />
                  </td>
                )
              })}
            </tr>
          ))}

          <TotalsRow
            days={days}
            entries={entries}
            capacityMinutes={capacityMinutes}
            minutesParJour={minutesParJour}
          />
        </tbody>
      </table>
    </div>
  )
}
