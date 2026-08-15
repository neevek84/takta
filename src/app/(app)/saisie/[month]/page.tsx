import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { listActiveLines } from '@/services/missions'
import {
  getLineEngagementTotals,
  getMonthEntries,
  getPastForecastWithLockStatus,
} from '@/services/time-entries'
import { buildMonthDays } from '@/core/month/build'
import { centiemesToMinutes } from '@/core/time/units'
import { MonthNav } from '@/components/MonthNav'
import { PastForecastNotice } from './PastForecastNotice'
import { SaisieClient } from './SaisieClient'

export default async function SaisiePage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params
  const user = await requireUser()

  const settings = await getSettings()
  const lines = await listActiveLines(user.id)
  const entries = await getMonthEntries(user.id, month)
  // L'engagement se lit sur toute la durée de la ligne, pas sur le mois affiché.
  const engagementTotals = await getLineEngagementTotals(
    user.id,
    lines.map((l) => l.id),
  )
  const days = buildMonthDays(month, settings.workingDays, settings.holidays)

  // Rappel du prévisionnel échu : un simple encart, jamais une conversion
  // automatique — voir PastForecastNotice. Les deux chiffres viennent du même
  // partage que la conversion, dans la couche service : la page ne réimplémente
  // ni le filtre « prévisionnel échu », ni l'évaluation du verrou.
  const today = new Date().toISOString().slice(0, 10)
  const pastForecast = await getPastForecastWithLockStatus(user.id, month, today)

  return (
    <main className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Saisie</h1>
      <MonthNav month={month} />
      <PastForecastNotice
        month={month}
        entries={pastForecast.entries}
        lockedCount={pastForecast.lockedCount}
      />
      <SaisieClient
        month={month}
        days={days}
        lines={lines}
        entries={entries}
        engagementTotals={engagementTotals}
        capacityMinutes={centiemesToMinutes(settings.capacityCentiemes, settings.minutesParJour)}
        minutesParJour={settings.minutesParJour}
      />
    </main>
  )
}
