import { prisma } from '@/db/client'
import { checkCapacity } from '@/core/capacity/check'
import { isLocked } from '@/core/cra/state-machine'
import { cellStateToWrite } from '@/core/saisie/cell-state'
import { isSlotAllowed } from '@/core/saisie/cycle'
import type { CellState } from '@/core/saisie/cycle'
import type { CraStatus, TimeEntryKind } from '@/core/types'
import { getSettings } from './settings'
import { resolveLineMinutesParJour, type CapacityWarning } from './time-entries'

export type CellResult =
  | { ok: true; state: CellState; warning?: CapacityWarning; signalement?: string }
  | { ok: false; reason: 'CAPACITE'; totalCentiemes: number; capacityCentiemes: number }
  | { ok: false; reason: 'VERROUILLE' }
  | { ok: false; reason: 'NON_AFFECTE' }
  | { ok: false; reason: 'SAISIE_INVALIDE' }

function monthStartOf(month: string): Date {
  return new Date(`${month.slice(0, 7)}-01T00:00:00.000Z`)
}

/**
 * Verrou du CRA d'une prestation sur un mois.
 *
 * Le statut n'est jamais comparé littéralement : `isLocked` est la seule
 * autorité, pour que le jour où un statut supplémentaire verrouille, la
 * cinématique, le remplissage et le vidage le voient tous les trois.
 */
export async function isMonthLocked(
  userId: string,
  lineId: string,
  month: string,
): Promise<boolean> {
  const line = await prisma.missionLine.findUnique({
    where: { id: lineId },
    select: { missionId: true },
  })
  if (line === null) return false

  const cra = await prisma.cra.findUnique({
    where: {
      missionId_userId_month: { missionId: line.missionId, userId, month: monthStartOf(month) },
    },
    select: { status: true },
  })

  return cra !== null && isLocked(cra.status as CraStatus)
}

/** Une durée libre venue du client n'est jamais crue sur parole. */
function dureeExploitable(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 1440
}

/**
 * Remplace en bloc les saisies d'une case (prestation, jour) par celles que
 * `state` décrit.
 *
 * Le remplacement en bloc — et non une suite d'écritures unitaires — est ce
 * qui rend la cinématique juste : passer de « 1 jour » à « ½ matin » supprime
 * la saisie sans créneau et écrit celle du matin, sans jamais laisser
 * coexister les deux, ni compter la case remplacée dans sa propre capacité.
 */
export async function applyCellState(args: {
  userId: string
  lineId: string
  /** 'YYYY-MM-DD' */
  date: string
  kind: TimeEntryKind
  state: CellState
}): Promise<CellResult> {
  const settings = await getSettings()
  const date = new Date(`${args.date}T00:00:00.000Z`)

  // L'affectation est la porte d'entrée : le scope vit dans le service, jamais
  // dans le server action qui l'appelle.
  const assignment = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: { line: { select: { allowedSlotIds: true } } },
  })
  if (assignment === null) return { ok: false, reason: 'NON_AFFECTE' }

  if (await isMonthLocked(args.userId, args.lineId, args.date.slice(0, 7))) {
    return { ok: false, reason: 'VERROUILLE' }
  }

  if (args.state.kind === 'LIBRE' && !dureeExploitable(args.state.minutes)) {
    return { ok: false, reason: 'SAISIE_INVALIDE' }
  }

  const minutesParJour = await resolveLineMinutesParJour(args.lineId, settings.minutesParJour)

  let cibles
  try {
    cibles = cellStateToWrite(args.state, { minutesParJour, slots: settings.slots })
  } catch {
    return { ok: false, reason: 'SAISIE_INVALIDE' }
  }

  // Total du jour hors la case qu'on remplace : toutes ses saisies partent,
  // les compter ferait refuser une correction qui allège pourtant la journée.
  //
  // `minutesParJour` est lu sur chaque saisie — la valeur figée à son
  // écriture, jamais une valeur recalculée : c'est ce qui garantit qu'un CRA
  // validé ne change pas de calcul quand le réglage global bouge.
  const jour = await prisma.timeEntry.findMany({
    where: { userId: args.userId, date },
    select: { minutes: true, lineId: true, minutesParJour: true },
  })
  const existing = jour
    .filter((e) => e.lineId !== args.lineId)
    .map((e) => ({ minutes: e.minutes, minutesParJour: e.minutesParJour }))
  // Les cases à écrire portent le facteur que la ligne vient de résoudre,
  // c'est-à-dire celui qui sera figé quelques lignes plus bas.
  const added = cibles.map((c) => ({ minutes: c.minutes, minutesParJour }))

  const verdict = checkCapacity({
    existing,
    added,
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

  // Suppression et écriture dans la même transaction : deux requêtes séparées
  // laisseraient la case vide si la seconde échouait.
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.deleteMany({ where: { userId: args.userId, lineId: args.lineId, date } })
    for (const cible of cibles) {
      await tx.timeEntry.create({
        data: {
          lineId: args.lineId,
          userId: args.userId,
          date,
          slotId: cible.slotId,
          minutes: cible.minutes,
          kind: args.kind,
          minutesParJour,
        },
      })
    }
  })

  const allowed =
    assignment.line.allowedSlotIds === '' ? [] : assignment.line.allowedSlotIds.split(',')
  const horsCadre = cibles
    .map((c) => c.slotId)
    .filter((slotId) => !isSlotAllowed(slotId, allowed))
    .map((slotId) => settings.slots.find((s) => s.id === slotId)?.label ?? slotId)

  const warning: CapacityWarning | undefined =
    !verdict.ok && verdict.severity === 'warn'
      ? { totalCentiemes: verdict.totalCentiemes, capacityCentiemes: verdict.capacityCentiemes }
      : undefined

  // Signalement, jamais refus : la prestation restreint ce que la cinématique
  // propose, elle n'interdit pas ce que l'utilisateur choisit au formulaire.
  const signalement =
    horsCadre.length === 0
      ? undefined
      : `Créneau hors des créneaux autorisés pour cette prestation : ${horsCadre.join(', ')}. La saisie est conservée.`

  return {
    ok: true,
    state: args.state,
    ...(warning !== undefined && { warning }),
    ...(signalement !== undefined && { signalement }),
  }
}
