import { prisma } from '@/db/client'
import type { CraStatus, TimeEntryKind } from '@/core/types'
import { checkCapacity } from '@/core/capacity/check'
import { isLocked } from '@/core/cra/state-machine'
import { centiemesToMinutes } from '@/core/time/units'
import { getSettings } from './settings'

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

export type SaveResult =
  | { ok: true; minutes: number }
  | { ok: false; reason: 'CAPACITE'; totalMinutes: number; capacityMinutes: number }
  | { ok: false; reason: 'VERROUILLE' }

function monthStartOf(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 7)}-01T00:00:00.000Z`)
}

/**
 * Enregistre une saisie de temps pour une ligne/utilisateur/jour/créneau
 * donnés, en appliquant le verrouillage du CRA et le contrôle de capacité
 * quotidien (toutes lignes confondues, week-ends inclus).
 *
 * `minutes: 0` supprime la saisie existante plutôt que d'écrire une ligne à
 * zéro.
 */
export async function saveEntry(args: {
  userId: string
  lineId: string
  date: string
  minutes: number
  kind: TimeEntryKind
  slotId?: string
}): Promise<SaveResult> {
  const slotId = args.slotId ?? ''
  const date = new Date(`${args.date}T00:00:00.000Z`)
  const settings = await getSettings()

  const line = await prisma.missionLine.findUniqueOrThrow({
    where: { id: args.lineId },
    select: { missionId: true },
  })

  const cra = await prisma.cra.findUnique({
    where: {
      missionId_userId_month: {
        missionId: line.missionId,
        userId: args.userId,
        month: monthStartOf(args.date),
      },
    },
    select: { status: true },
  })

  if (cra && isLocked(cra.status as CraStatus)) {
    return { ok: false, reason: 'VERROUILLE' }
  }

  if (args.minutes === 0) {
    await prisma.timeEntry.deleteMany({
      where: { userId: args.userId, lineId: args.lineId, date, slotId },
    })
    return { ok: true, minutes: 0 }
  }

  // Total du jour hors la clé qu'on écrit : corriger une valeur ne doit pas
  // la compter deux fois.
  const sameDay = await prisma.timeEntry.findMany({
    where: { userId: args.userId, date },
    select: { minutes: true, lineId: true, slotId: true },
  })
  const existingMinutes = sameDay
    .filter((e) => !(e.lineId === args.lineId && e.slotId === slotId))
    .reduce((sum, e) => sum + e.minutes, 0)

  const verdict = checkCapacity({
    existingMinutes,
    addedMinutes: args.minutes,
    capacityMinutes: centiemesToMinutes(settings.capacityCentiemes, settings.minutesParJour),
    mode: settings.capacityMode,
  })

  if (!verdict.ok && verdict.severity === 'block') {
    return {
      ok: false,
      reason: 'CAPACITE',
      totalMinutes: verdict.totalMinutes,
      capacityMinutes: verdict.capacityMinutes,
    }
  }

  await prisma.timeEntry.upsert({
    where: {
      lineId_userId_date_slotId: { lineId: args.lineId, userId: args.userId, date, slotId },
    },
    create: {
      lineId: args.lineId,
      userId: args.userId,
      date,
      slotId,
      minutes: args.minutes,
      kind: args.kind,
    },
    update: { minutes: args.minutes, kind: args.kind },
  })

  return { ok: true, minutes: args.minutes }
}
