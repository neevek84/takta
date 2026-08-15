import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { listActiveLines } from '@/services/missions'
import { getMonthEntries } from '@/services/time-entries'
import { buildMonthDays } from '@/core/month/build'
import { centiemesToMinutes } from '@/core/time/units'
import { SaisieClient } from './SaisieClient'

export default async function SaisiePage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params
  const user = await requireUser()

  const settings = await getSettings()
  const lines = await listActiveLines(user.id)
  const entries = await getMonthEntries(user.id, month)
  const days = buildMonthDays(month, settings.workingDays, settings.holidays)

  return (
    <main className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Saisie · {month}</h1>
      <SaisieClient
        month={month}
        days={days}
        lines={lines}
        entries={entries}
        capacityMinutes={centiemesToMinutes(settings.capacityCentiemes, settings.minutesParJour)}
      />
    </main>
  )
}
