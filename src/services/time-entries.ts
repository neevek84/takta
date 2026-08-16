import { prisma } from '@/db/client'
import type { CraStatus, TimeEntryKind } from '@/core/types'
import { checkCapacity } from '@/core/capacity/check'
import { isLocked } from '@/core/cra/state-machine'
import { resolveMinutesParJour } from '@/core/rates/cascade'
import { getSettings } from './settings'
import { enqueueTimeEntry } from './sync/outbox'

export interface MonthEntry {
  id: string
  lineId: string
  /** 'YYYY-MM-DD' */
  date: string
  minutes: number
  kind: TimeEntryKind
  /** chaîne vide = journée entière */
  slotId: string
  /** durée d'une journée figée à l'écriture, en minutes */
  minutesParJour: number
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
    minutesParJour: r.minutesParJour,
  }))
}

export interface LineEngagementEntry {
  kind: TimeEntryKind
  minutes: number
  /** durée d'une journée figée à l'écriture des saisies regroupées ici */
  minutesParJour: number
}

/**
 * Cumul des minutes d'une ligne, ventilé par facteur de conversion figé à
 * l'écriture (voir `minutesParJour` sur `TimeEntry`).
 *
 * Volontairement *pas* un total déjà converti : deux saisies écrites sous des
 * facteurs différents (avant/après un changement de réglage ou de cascade) ne
 * s'additionnent pas en minutes brutes sans réinterpréter l'historique. C'est
 * `computeEngagement` — jamais ce module ni ses appelants — qui sait convertir
 * chaque groupe séparément avant de sommer les centièmes.
 */
export type LineEngagementTotals = LineEngagementEntry[]

/**
 * Totaux d'une ligne de prestation, **toutes périodes confondues**.
 *
 * L'engagement d'une ligne est un cumul sur toute sa durée : le borner au mois
 * affiché, comme le fait `getMonthEntries`, donne un reste à consommer faux dès
 * le deuxième mois de la mission.
 *
 * Renvoie une entrée pour chaque `lineId` demandé, à zéro (tableau vide) quand
 * la ligne n'a aucune saisie. Scopé par `userId` comme toute fonction de
 * service.
 */
export async function getLineEngagementTotals(
  userId: string,
  lineIds: string[],
): Promise<Record<string, LineEngagementTotals>> {
  const totals: Record<string, LineEngagementTotals> = {}
  for (const id of lineIds) totals[id] = []
  if (lineIds.length === 0) return totals

  // Groupé par facteur en plus de la ligne et du type : additionner des
  // minutes converties à des facteurs différents n'a aucun sens (voir
  // `LineEngagementTotals`).
  const rows = await prisma.timeEntry.groupBy({
    by: ['lineId', 'kind', 'minutesParJour'],
    where: { userId, lineId: { in: lineIds } },
    _sum: { minutes: true },
  })

  for (const row of rows) {
    const bucket = totals[row.lineId]
    if (bucket === undefined) continue
    const minutes = row._sum.minutes ?? 0
    if (minutes === 0) continue
    bucket.push({ kind: row.kind as TimeEntryKind, minutes, minutesParJour: row.minutesParJour })
  }

  return totals
}

/**
 * Dépassement de capacité signalé sans blocage (mode `AVERTISSEMENT`).
 *
 * En centièmes de jour : c'est la seule unité dans laquelle la charge d'une
 * journée et la capacité réglée sont comparables (voir `checkCapacity`).
 */
export interface CapacityWarning {
  totalCentiemes: number
  capacityCentiemes: number
}

/**
 * Créneau saisi que la ligne ne prévoit pas — signalement, jamais refus.
 *
 * La règle est celle du lot 0, déjà appliquée par `applyCellState` pour la vue
 * calendrier : la prestation restreint ce que la cinématique *propose*, elle
 * n'interdit pas ce que l'utilisateur décrit. Refuser reviendrait à lui
 * interdire de déclarer une nuit réellement travaillée.
 */
export interface SlotWarning {
  slotId: string
  allowedSlotIds: string[]
}

export type SaveResult =
  | { ok: true; minutes: number; warning?: CapacityWarning; slotWarning?: SlotWarning }
  | { ok: false; reason: 'CAPACITE'; totalCentiemes: number; capacityCentiemes: number }
  | { ok: false; reason: 'VERROUILLE' }
  | { ok: false; reason: 'NON_AFFECTE' }

function monthStartOf(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 7)}-01T00:00:00.000Z`)
}

/**
 * Facteur effectif d'une prestation, en remontant la cascade
 * prestation → mission → client → global.
 *
 * Exporté : le service des cases fige exactement le même facteur que
 * `saveEntry`, sans le recalculer autrement.
 */
export async function resolveLineMinutesParJour(
  lineId: string,
  globalMinutesParJour: number,
): Promise<number> {
  const line = await prisma.missionLine.findUniqueOrThrow({
    where: { id: lineId },
    select: {
      minutesParJour: true,
      mission: {
        select: { minutesParJour: true, client: { select: { minutesParJour: true } } },
      },
    },
  })

  return resolveMinutesParJour({
    line: line.minutesParJour,
    mission: line.mission.minutesParJour,
    client: line.mission.client.minutesParJour,
    global: globalMinutesParJour,
  })
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
    select: { line: { select: { missionId: true, allowedSlotIds: true } } },
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
    // La suppression et sa mise en file tiennent dans la même transaction :
    // une suppression qui échapperait à la file laisserait un bloc fantôme
    // occuper une journée qu'on pourrait revendre.
    await prisma.$transaction(async (tx) => {
      const existing = await tx.timeEntry.findUnique({
        where: {
          lineId_userId_date_slotId: { lineId: args.lineId, userId: args.userId, date, slotId },
        },
        select: { id: true },
      })
      if (existing === null) return

      await tx.timeEntry.delete({ where: { id: existing.id } })
      await enqueueTimeEntry(tx, {
        userId: args.userId,
        entryId: existing.id,
        operation: 'DELETE',
      })
    })

    return { ok: true, minutes: 0 }
  }

  // Le facteur de conversion est figé au moment de l'écriture : le rejouer au
  // moment de la lecture réinterpréterait tout l'historique dès que le
  // réglage change. Il est résolu avant le contrôle de capacité, qui compare
  // en centièmes de jour et a donc besoin du facteur que cette saisie portera.
  const minutesParJour = await resolveLineMinutesParJour(args.lineId, settings.minutesParJour)

  // Total du jour hors la clé qu'on écrit : corriger une valeur ne doit pas
  // la compter deux fois. Chaque saisie est reprise avec **son** facteur figé,
  // jamais avec le réglage du moment — un CRA validé ne change pas de calcul.
  const sameDay = await prisma.timeEntry.findMany({
    where: { userId: args.userId, date },
    select: { minutes: true, lineId: true, slotId: true, minutesParJour: true },
  })
  const existing = sameDay
    .filter((e) => !(e.lineId === args.lineId && e.slotId === slotId))
    .map((e) => ({ minutes: e.minutes, minutesParJour: e.minutesParJour }))

  const verdict = checkCapacity({
    existing,
    added: [{ minutes: args.minutes, minutesParJour }],
    capacityCentiemes: settings.capacityCentiemes,
    mode: settings.capacityMode,
  })

  if (!verdict.ok && verdict.severity === 'block') {
    return {
      ok: false,
      reason: 'CAPACITE',
      totalCentiemes: verdict.totalCentiemes,
      capacityCentiemes: verdict.capacityCentiemes,
    }
  }

  // En mode AVERTISSEMENT, le dépassement n'empêche pas l'enregistrement mais
  // doit remonter jusqu'à l'écran — sans quoi le mode est indiscernable de
  // DESACTIVE.
  const warning: CapacityWarning | null =
    !verdict.ok && verdict.severity === 'warn'
      ? { totalCentiemes: verdict.totalCentiemes, capacityCentiemes: verdict.capacityCentiemes }
      : null

  await prisma.$transaction(async (tx) => {
    const entry = await tx.timeEntry.upsert({
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
        minutesParJour,
      },
      update: { minutes: args.minutes, kind: args.kind, minutesParJour },
    })

    await enqueueTimeEntry(tx, { userId: args.userId, entryId: entry.id, operation: 'UPSERT' })
  })

  // Une ligne qui n'énumère aucun créneau les accepte tous ; une saisie à la
  // journée n'est jamais concernée. La liste est stockée en chaîne séparée par
  // des virgules — aucun tableau en base, pour rester portable.
  const allowedSlotIds =
    assignment.line.allowedSlotIds === '' ? [] : assignment.line.allowedSlotIds.split(',')
  const slotWarning: SlotWarning | null =
    slotId !== '' && allowedSlotIds.length > 0 && !allowedSlotIds.includes(slotId)
      ? { slotId, allowedSlotIds }
      : null

  // Le signalement se calcule **après** l'écriture, et il ne la conditionne
  // pas : la saisie est déjà en base et déjà en file quand cette phrase se
  // forme.
  return {
    ok: true,
    minutes: args.minutes,
    ...(warning === null ? {} : { warning }),
    ...(slotWarning === null ? {} : { slotWarning }),
  }
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
 * Partage le prévisionnel échu d'un mois entre ce qui est convertible et ce
 * que le verrou du CRA retient.
 *
 * Le verrou porte sur un couple (mission, mois) : un même mois peut mêler une
 * mission verrouillée et une mission ouverte. Il s'évalue par `isLocked`, et
 * jamais par une comparaison littérale de statut — c'est la raison d'être de
 * cette fonction : l'encart de la page de saisie et le bouton qui convertit
 * lisent le **même** partage, et ne peuvent donc pas diverger le jour où
 * `isLocked` s'étendra à un statut supplémentaire.
 */
async function splitPastForecastByLock(
  userId: string,
  month: string,
  today: string,
): Promise<{ candidates: MonthEntry[]; convertibles: MonthEntry[]; lockedCount: number }> {
  const candidates = await listPastForecast(userId, month, today)
  if (candidates.length === 0) return { candidates, convertibles: [], lockedCount: 0 }

  const lines = await prisma.missionLine.findMany({
    where: {
      id: { in: [...new Set(candidates.map((e) => e.lineId))] },
      assignments: { some: { userId } },
    },
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

  return { candidates, convertibles, lockedCount: candidates.length - convertibles.length }
}

export interface PastForecastStatus {
  /** Jours prévisionnels échus du mois, verrouillés compris. */
  entries: MonthEntry[]
  /** Combien d'entre eux appartiennent à une mission dont le CRA est verrouillé. */
  lockedCount: number
}

/**
 * Les deux chiffres que l'encart du prévisionnel échu affiche, d'un seul
 * tenant : les jours échus et le nombre d'entre eux que le verrou retient.
 *
 * Purement lecture — la conversion n'est jamais automatique, elle reste à
 * l'initiative de l'utilisateur (`convertPastForecast`).
 */
export async function getPastForecastWithLockStatus(
  userId: string,
  month: string,
  today: string,
): Promise<PastForecastStatus> {
  const { candidates, lockedCount } = await splitPastForecastByLock(userId, month, today)
  return { entries: candidates, lockedCount }
}

/**
 * Convertit en `REALISE` le prévisionnel échu d'un mois, jamais automatiquement
 * — seulement à la demande explicite de l'utilisateur (voir `validerJoursPasses`).
 *
 * On traite les missions ouvertes et on compte celles qu'on a sautées, plutôt
 * que de tout refuser en bloc dès qu'une mission du mois est verrouillée.
 */
export async function convertPastForecast(
  userId: string,
  month: string,
  today: string,
): Promise<{ converted: number; skippedLocked: number }> {
  const { convertibles, lockedCount } = await splitPastForecastByLock(userId, month, today)

  if (convertibles.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.timeEntry.updateMany({
        where: { id: { in: convertibles.map((e) => e.id) }, userId },
        data: { kind: 'REALISE' },
      })

      // Le prévisionnel converti change de couleur dans l'agenda : chaque
      // saisie repart donc dans la file, dans la transaction qui la convertit.
      for (const e of convertibles) {
        await enqueueTimeEntry(tx, { userId, entryId: e.id, operation: 'UPSERT' })
      }
    })
  }

  return { converted: convertibles.length, skippedLocked: lockedCount }
}
