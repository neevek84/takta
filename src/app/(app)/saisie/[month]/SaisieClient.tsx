'use client'

import { useState } from 'react'
import { MonthGrid } from '@/components/grid/MonthGrid'
import { Banner } from '@/components/ui/Banner'
import { saveCell } from './actions'
import type { MonthDay } from '@/core/month/build'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals, MonthEntry } from '@/services/time-entries'

function heures(minutes: number): string {
  return String(Math.round((minutes / 60) * 100) / 100).replace('.', ',')
}

export function SaisieClient(props: {
  month: string
  days: MonthDay[]
  lines: LineForGrid[]
  entries: MonthEntry[]
  engagementTotals: Record<string, LineEngagementTotals>
  capacityMinutes: number
  minutesParJour: number
}) {
  const [message, setMessage] = useState<string | null>(null)

  /** Renvoie `true` quand la valeur a bien été enregistrée. */
  async function handleSave(lineId: string, date: string, raw: string): Promise<boolean> {
    const kind = date >= new Date().toISOString().slice(0, 10) ? 'PREVISIONNEL' : 'REALISE'

    const r = await saveCell({ lineId, date, raw, kind, month: props.month })

    if (r.ok) {
      // Mode AVERTISSEMENT : la saisie est conservée, le dépassement signalé.
      setMessage(
        r.warning
          ? `Capacité dépassée le ${date} : ${heures(r.warning.totalMinutes)} h saisies pour ${heures(r.warning.capacityMinutes)} h disponibles. La saisie est conservée.`
          : null,
      )
      return true
    }

    if (r.reason === 'CAPACITE') {
      setMessage(
        `Capacité dépassée le ${date} : ${heures(r.totalMinutes)} h saisies pour ${heures(r.capacityMinutes)} h disponibles. La saisie est refusée.`,
      )
    } else if (r.reason === 'VERROUILLE') {
      setMessage(`Le CRA de ce mois est validé. Rouvrez-le pour modifier la saisie.`)
    } else if (r.reason === 'NON_AFFECTE') {
      setMessage(`Vous n'êtes pas affecté à cette ligne de prestation.`)
    } else {
      setMessage(`Saisie invalide.`)
    }
    return false
  }

  return (
    <>
      {message && (
        <div className="mb-3">
          <Banner tone="warning">{message}</Banner>
        </div>
      )}
      <MonthGrid
        days={props.days}
        lines={props.lines}
        entries={props.entries}
        engagementTotals={props.engagementTotals}
        capacityMinutes={props.capacityMinutes}
        minutesParJour={props.minutesParJour}
        onSave={handleSave}
      />
    </>
  )
}
