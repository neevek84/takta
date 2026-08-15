import { prisma } from '@/db/client'
import type { TimeEntryKind } from '@/core/types'

export interface MonthEntry {
  id: string
  lineId: string
  /** 'YYYY-MM-DD' */
  date: string
  minutes: number
  kind: TimeEntryKind
  /** chaîne vide = journée entière */
  slotId: string
}

function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  }
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function getMonthEntries(userId: string, month: string): Promise<MonthEntry[]> {
  const { start, end } = monthBounds(month)

  const rows = await prisma.timeEntry.findMany({
    where: { userId, date: { gte: start, lt: end } },
    orderBy: { date: 'asc' },
  })

  return rows.map((r) => ({
    id: r.id,
    lineId: r.lineId,
    date: toIsoDate(r.date),
    minutes: r.minutes,
    kind: r.kind as TimeEntryKind,
    slotId: r.slotId,
  }))
}
