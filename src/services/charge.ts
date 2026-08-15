import { prisma } from '@/db/client'
import { fiscalYearFromStartYear, type FiscalYear } from '@/core/fiscal/year'
import {
  caFromEntries,
  exerciceProgress,
  tjmMoyenPondere,
  resteEnCentiemes,
  type ExerciceProgress,
} from '@/core/fiscal/revenue'
import { computeEngagement, type EngagementSummary } from '@/core/engagement/compute'
import { minutesToCentiemes } from '@/core/time/units'
import { listActiveLines } from './missions'
import { getSettings } from './settings'
import { toIsoDate } from './time-entries'
import type { TimeEntryKind } from '@/core/types'

export interface ChargeCell {
  realiseCentiemes: number
  prevuCentiemes: number
}

export interface ChargeRow {
  lineId: string
  label: string
  tjmCents: number
  /** un élément par mois de l'exercice, dans l'ordre */
  cells: ChargeCell[]
  engagement: EngagementSummary
  resteAVendreCents: number
}

export interface ChargeMatrix {
  fiscalYear: FiscalYear
  rows: ChargeRow[]
  monthTotals: Array<{ centiemes: number; caCents: number }>
  progress: ExerciceProgress
  /** reste à vendre traduit en centièmes de jour, null sans TJM moyen */
  resteEnJoursCentiemes: number | null
}

export async function buildChargeMatrix(
  userId: string,
  startYear: number,
): Promise<ChargeMatrix> {
  const settings = await getSettings()
  const fiscalYear = fiscalYearFromStartYear(startYear, settings.debutExerciceMois)
  const lines = await listActiveLines(userId)

  const emptyTotals = fiscalYear.months.map(() => ({ centiemes: 0, caCents: 0 }))

  if (lines.length === 0) {
    return {
      fiscalYear,
      rows: [],
      monthTotals: emptyTotals,
      progress: exerciceProgress(settings.objectifCaExerciceCents, 0, 0),
      resteEnJoursCentiemes: null,
    }
  }

  const lineIds = lines.map((l) => l.id)
  const monthIndex = new Map(fiscalYear.months.map((m, i) => [m, i]))

  // Toutes les entrées de l'utilisateur sur ces lignes, sans borne de date :
  // les cellules sont filtrées par mois, mais l'engagement se calcule sur
  // toute la durée de la ligne — comme au lot 0.
  const rows = await prisma.timeEntry.findMany({
    where: { userId, lineId: { in: lineIds } },
    select: { lineId: true, date: true, minutes: true, kind: true },
  })

  const entries = rows.map((r) => ({
    lineId: r.lineId,
    date: toIsoDate(r.date),
    minutes: r.minutes,
    kind: r.kind as TimeEntryKind,
  }))

  const priced = lines.map((l) => ({
    id: l.id,
    tjmCents: 0,
    minutesParJour: l.minutesParJour,
  }))
  const tjmByLine = await prisma.missionLine.findMany({
    where: { id: { in: lineIds } },
    select: { id: true, tjmCents: true },
  })
  const tjmMap = new Map(tjmByLine.map((l) => [l.id, l.tjmCents]))
  for (const p of priced) p.tjmCents = tjmMap.get(p.id) ?? 0

  const monthTotals = emptyTotals.map(() => ({ centiemes: 0, caCents: 0 }))

  const chargeRows: ChargeRow[] = lines.map((line) => {
    const lineEntries = entries.filter((e) => e.lineId === line.id)
    const cells: ChargeCell[] = fiscalYear.months.map(() => ({
      realiseCentiemes: 0,
      prevuCentiemes: 0,
    }))

    for (const e of lineEntries) {
      const i = monthIndex.get(e.date.slice(0, 7))
      if (i === undefined) continue
      const c = minutesToCentiemes(e.minutes, line.minutesParJour)
      if (e.kind === 'REALISE') cells[i]!.realiseCentiemes += c
      else cells[i]!.prevuCentiemes += c
      monthTotals[i]!.centiemes += c
    }

    const engagement = computeEngagement({
      venduCentiemes: line.soldCentiemes,
      entries: lineEntries,
      minutesParJour: line.minutesParJour,
    })

    const tjmCents = tjmMap.get(line.id) ?? 0

    return {
      lineId: line.id,
      label: `${line.clientName} · ${line.missionLabel} · ${line.label}`,
      tjmCents,
      cells,
      engagement,
      resteAVendreCents: Math.round((engagement.resteCentiemes * tjmCents) / 100),
    }
  })

  for (const [i, month] of fiscalYear.months.entries()) {
    const ofMonth = entries.filter((e) => e.date.slice(0, 7) === month)
    monthTotals[i]!.caCents = caFromEntries(ofMonth, priced)
  }

  const inYear = entries.filter((e) => monthIndex.has(e.date.slice(0, 7)))
  const realiseCents = caFromEntries(inYear.filter((e) => e.kind === 'REALISE'), priced)
  const prevuCents = caFromEntries(inYear.filter((e) => e.kind === 'PREVISIONNEL'), priced)
  const progress = exerciceProgress(settings.objectifCaExerciceCents, realiseCents, prevuCents)

  const tjmMoyen = tjmMoyenPondere(
    lines.map((l) => ({ tjmCents: tjmMap.get(l.id) ?? 0, soldCentiemes: l.soldCentiemes })),
  )

  return {
    fiscalYear,
    rows: chargeRows,
    monthTotals,
    progress,
    resteEnJoursCentiemes: resteEnCentiemes(progress.resteAVendreCents, tjmMoyen),
  }
}
