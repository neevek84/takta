import { requireUser } from '@/auth'
import { prisma } from '@/db/client'
import { getSettings } from '@/services/settings'
import { listActiveLines } from '@/services/missions'
import { getLineEngagementTotals, getMonthEntries } from '@/services/time-entries'
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
  // automatique — voir PastForecastNotice.
  const today = new Date().toISOString().slice(0, 10)
  const pastForecast = entries.filter((e) => e.kind === 'PREVISIONNEL' && e.date < today)

  const lockedMissions = await prisma.cra.findMany({
    where: { userId: user.id, month: new Date(`${month}-01T00:00:00.000Z`), status: 'VALIDE' },
    select: { missionId: true },
  })
  const lockedIds = new Set(lockedMissions.map((c) => c.missionId))
  const lineMissions = await prisma.missionLine.findMany({
    where: { id: { in: [...new Set(pastForecast.map((e) => e.lineId))] } },
    select: { id: true, missionId: true },
  })
  const missionByLine = new Map(lineMissions.map((l) => [l.id, l.missionId]))
  const lockedCount = pastForecast.filter((e) => lockedIds.has(missionByLine.get(e.lineId) ?? '')).length

  return (
    <main className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Saisie</h1>
      <MonthNav month={month} />
      <PastForecastNotice month={month} entries={pastForecast} lockedCount={lockedCount} />
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
