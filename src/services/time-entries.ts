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

export interface LineEngagementTotals {
  realiseMinutes: number
  prevuMinutes: number
}

/**
 * Totaux d'une ligne de prestation, **toutes périodes confondues**.
 *
 * L'engagement d'une ligne est un cumul sur toute sa durée : le borner au mois
 * affiché, comme le fait `getMonthEntries`, donne un reste à consommer faux dès
 * le deuxième mois de la mission.
 *
 * Renvoie une entrée pour chaque `lineId` demandé, à zéro quand la ligne n'a
 * aucune saisie. Scopé par `userId` comme toute fonction de service.
 */
export async function getLineEngagementTotals(
  userId: string,
  lineIds: string[],
): Promise<Record<string, LineEngagementTotals>> {
  const totals: Record<string, LineEngagementTotals> = {}
  for (const id of lineIds) totals[id] = { realiseMinutes: 0, prevuMinutes: 0 }
  if (lineIds.length === 0) return totals

  const rows = await prisma.timeEntry.groupBy({
    by: ['lineId', 'kind'],
    where: { userId, lineId: { in: lineIds } },
    _sum: { minutes: true },
  })

  for (const row of rows) {
    const bucket = totals[row.lineId]
    if (bucket === undefined) continue
    const minutes = row._sum.minutes ?? 0
    if ((row.kind as TimeEntryKind) === 'REALISE') bucket.realiseMinutes += minutes
    else bucket.prevuMinutes += minutes
  }

  return totals
}

/** Dépassement de capacité signalé sans blocage (mode `AVERTISSEMENT`). */
export interface CapacityWarning {
  totalMinutes: number
  capacityMinutes: number
}

export type SaveResult =
  | { ok: true; minutes: number; warning?: CapacityWarning }
  | { ok: false; reason: 'CAPACITE'; totalMinutes: number; capacityMinutes: number }
  | { ok: false; reason: 'VERROUILLE' }
  | { ok: false; reason: 'NON_AFFECTE' }

function monthStartOf(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 7)}-01T00:00:00.000Z`)
}

/**
 * Enregistre une saisie de temps pour une ligne/utilisateur/jour/créneau
 * donnés, en appliquant l'affectation, le verrouillage du CRA et le contrôle
 * de capacité quotidien (toutes lignes confondues, week-ends inclus).
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

  // L'affectation est la porte d'entrée : sans elle, n'importe quel userId
  // pourrait imputer du temps sur la ligne d'engagement d'un autre. Le scope
  // vit dans le service, pas dans le server action qui l'appelle.
  const assignment = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: { line: { select: { missionId: true } } },
  })

  if (assignment === null) {
    return { ok: false, reason: 'NON_AFFECTE' }
  }

  const cra = await prisma.cra.findUnique({
    where: {
      missionId_userId_month: {
        missionId: assignment.line.missionId,
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

  // En mode AVERTISSEMENT, le dépassement n'empêche pas l'enregistrement mais
  // doit remonter jusqu'à l'écran — sans quoi le mode est indiscernable de
  // DESACTIVE.
  const warning: CapacityWarning | null =
    !verdict.ok && verdict.severity === 'warn'
      ? { totalMinutes: verdict.totalMinutes, capacityMinutes: verdict.capacityMinutes }
      : null

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

  return warning === null
    ? { ok: true, minutes: args.minutes }
    : { ok: true, minutes: args.minutes, warning }
}

/**
 * Prévisionnel strictement antérieur à `today`, pour le mois donné.
 *
 * `today` est un paramètre (jamais lu de l'horloge ici) afin que la fonction
 * reste testable sans geler le temps.
 */
export async function listPastForecast(
  userId: string,
  month: string,
  today: string,
): Promise<MonthEntry[]> {
  const entries = await getMonthEntries(userId, month)
  return entries.filter((e) => e.kind === 'PREVISIONNEL' && e.date < today)
}

/**
 * Convertit en `REALISE` le prévisionnel échu d'un mois, jamais automatiquement
 * — seulement à la demande explicite de l'utilisateur (voir `validerJoursPasses`).
 *
 * Le verrou du CRA porte sur un couple (mission, mois) : un même mois peut
 * mêler une mission verrouillée et une mission ouverte. On traite donc les
 * missions ouvertes et on compte celles qu'on a sautées, plutôt que de tout
 * refuser en bloc dès qu'une mission du mois est verrouillée.
 */
export async function convertPastForecast(
  userId: string,
  month: string,
  today: string,
): Promise<{ converted: number; skippedLocked: number }> {
  const candidates = await listPastForecast(userId, month, today)
  if (candidates.length === 0) return { converted: 0, skippedLocked: 0 }

  const lines = await prisma.missionLine.findMany({
    where: { id: { in: [...new Set(candidates.map((e) => e.lineId))] } },
    select: { id: true, missionId: true },
  })
  const missionByLine = new Map(lines.map((l) => [l.id, l.missionId]))

  const cras = await prisma.cra.findMany({
    where: {
      userId,
      month: new Date(`${month}-01T00:00:00.000Z`),
      missionId: { in: [...new Set(lines.map((l) => l.missionId))] },
    },
    select: { missionId: true, status: true },
  })
  const lockedMissions = new Set(
    cras.filter((c) => isLocked(c.status as CraStatus)).map((c) => c.missionId),
  )

  const convertibles = candidates.filter((e) => {
    const missionId = missionByLine.get(e.lineId)
    return missionId !== undefined && !lockedMissions.has(missionId)
  })

  if (convertibles.length > 0) {
    await prisma.timeEntry.updateMany({
      where: { id: { in: convertibles.map((e) => e.id) }, userId },
      data: { kind: 'REALISE' },
    })
  }

  return {
    converted: convertibles.length,
    skippedLocked: candidates.length - convertibles.length,
  }
}
