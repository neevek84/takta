'use client'

import { useState, useTransition } from 'react'
import { MonthGrid } from '@/components/grid/MonthGrid'
import { saveCell } from './actions'
import type { MonthDay } from '@/core/month/build'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'

export function SaisieClient(props: {
  month: string
  days: MonthDay[]
  lines: LineForGrid[]
  entries: MonthEntry[]
  capacityMinutes: number
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function handleSave(lineId: string, date: string, raw: string) {
    const kind = date >= new Date().toISOString().slice(0, 10) ? 'PREVISIONNEL' : 'REALISE'

    startTransition(async () => {
      const r = await saveCell({ lineId, date, raw, kind, month: props.month })
      if (r.ok) {
        setMessage(null)
        return
      }
      if (r.reason === 'CAPACITE') {
        setMessage(
          `Capacité dépassée le ${date} : ${r.totalMinutes / 60} h saisies pour ${r.capacityMinutes / 60} h disponibles.`,
        )
      } else if (r.reason === 'VERROUILLE') {
        setMessage(`Le CRA de ce mois est validé. Rouvrez-le pour modifier la saisie.`)
      } else {
        setMessage(`Saisie invalide.`)
      }
    })
  }

  return (
    <>
      {message && (
        <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {message}
        </p>
      )}
      <MonthGrid
        days={props.days}
        lines={props.lines}
        entries={props.entries}
        capacityMinutes={props.capacityMinutes}
        onSave={handleSave}
      />
    </>
  )
}
