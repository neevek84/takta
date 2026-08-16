import { prisma } from '@/db/client'
import { checkCapacity } from '@/core/capacity/check'
import { isLocked } from '@/core/cra/state-machine'
import { cellStateToWrite } from '@/core/saisie/cell-state'
import { isSlotAllowed } from '@/core/saisie/cycle'
import type { CellState } from '@/core/saisie/cycle'
import type { CraStatus, TimeEntryKind } from '@/core/types'
import { getSettings } from './settings'
import { enqueueTimeEntry } from './sync/outbox'
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
 * Aligne les saisies d'une case (prestation, jour) sur ce que `state` décrit.
 *
 * Le rapprochement se fait **par cible**, jamais par table rase : la clé
 * `(lineId, userId, date, slotId)` désigne une saisie, et une saisie dont la
 * cible survit est *mise à jour*, pas détruite puis récrite sous un identifiant
 * neuf. C'est ce que `saveEntry` fait déjà, et ce que le porteur a tranché :
 * l'identifiant porte le bloc de l'agenda, le faire tourner à chaque correction
 * fait disparaître puis réapparaître l'événement — et laisse dix lignes en file
 * pour dix retouches, là où la file dédoublonne par identifiant.
 *
 * La cinématique reste juste pour autant : passer de « 1 jour » à « ½ matin »
 * change de cible (`''` → `'matin'`), donc la saisie sans créneau disparaît
 * **réellement** et celle du matin naît, sans jamais laisser coexister les deux.
 * Ce qui cesse, c'est de détruire une saisie dont la cible existe toujours.
 *
 * Le rapprochement entier tient dans une transaction : deux requêtes séparées
 * laisseraient la case vide si la seconde échouait. Et la case remplacée reste
 * exclue de son propre contrôle de capacité, mise à jour ou non.
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

  // Suppressions, écritures **et** mises en file dans la même transaction :
  // deux requêtes séparées laisseraient la case vide si la seconde échouait, et
  // une mise en file hors transaction ferait bien pire — une saisie enregistrée
  // sans sa ligne en file ne partirait jamais vers l'agenda, et personne ne le
  // saurait. C'est le chemin d'écriture du calendrier, la seule surface de
  // saisie sous la largeur `md` : le trou y serait quasi total.
  await prisma.$transaction(async (tx) => {
    // Relevé scopé par utilisateur, comme la suppression qui suit : la même
    // prestation le même jour peut porter la saisie d'un autre, qu'il ne faut
    // ni retirer ni mettre en file.
    const presentes = await tx.timeEntry.findMany({
      where: { userId: args.userId, lineId: args.lineId, date },
      select: { id: true, slotId: true },
    })

    // Ne disparaissent que les saisies dont plus aucune cible ne porte le
    // créneau — un vidage, ou un changement de forme. Celles dont la cible
    // survit sont mises à jour plus bas, sous leur identifiant d'origine.
    const cibleSlotIds = new Set(cibles.map((c) => c.slotId))
    const emportees = presentes.filter((e) => !cibleSlotIds.has(e.slotId))

    if (emportees.length > 0) {
      // Les identifiants sont relevés avant la suppression : le bloc d'agenda
      // d'une saisie emportée ne disparaîtra que si sa suppression entre en
      // file.
      await tx.timeEntry.deleteMany({
        where: { userId: args.userId, id: { in: emportees.map((e) => e.id) } },
      })
      for (const emportee of emportees) {
        await enqueueTimeEntry(tx, {
          userId: args.userId,
          entryId: emportee.id,
          operation: 'DELETE',
        })
      }
    }

    for (const cible of cibles) {
      // `upsert` sur la clé unique, exactement comme `saveEntry` : l'identifiant
      // survit à la correction, donc l'événement d'agenda aussi, et la file
      // dédoublonne les retouches successives en une seule ligne.
      const entry = await tx.timeEntry.upsert({
        where: {
          lineId_userId_date_slotId: {
            lineId: args.lineId,
            userId: args.userId,
            date,
            slotId: cible.slotId,
          },
        },
        create: {
          lineId: args.lineId,
          userId: args.userId,
          date,
          slotId: cible.slotId,
          minutes: cible.minutes,
          kind: args.kind,
          minutesParJour,
        },
        // `minutesParJour` est réécrit avec la saisie : le gel porte sur
        // l'écriture, et une case retouchée *est* une écriture — c'est déjà la
        // règle de `saveEntry`. Ce qu'il interdit, c'est qu'un réglage global
        // modifié rejaillisse sur une saisie que personne n'a retouchée.
        update: { minutes: cible.minutes, kind: args.kind, minutesParJour },
      })

      await enqueueTimeEntry(tx, { userId: args.userId, entryId: entry.id, operation: 'UPSERT' })
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
