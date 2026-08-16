import { prisma } from '@/db/client'
import { buildMonthDays } from '@/core/month/build'
import type { ClearReport, FillReport } from '@/core/saisie/report'
import { getSettings } from './settings'
import { applyCellState, isMonthLocked } from './cells'
import { toIsoDate } from './time-entries'

function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) }
}

async function assertAffecte(userId: string, lineId: string): Promise<void> {
  const assignment = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId, userId } },
    select: { id: true },
  })
  if (assignment === null) {
    throw new Error("Cette prestation n'est pas affectée à cet utilisateur.")
  }
}

/**
 * Pose une journée sur chaque jour ouvré du mois pour une prestation.
 *
 * `today` est un paramètre et jamais l'horloge : c'est lui qui départage le
 * réalisé du prévisionnel, et le geler dans le service rendrait la fonction
 * intestable.
 *
 * Un jour déjà saisi sur cette prestation est **sauté**, jamais écrasé — c'est
 * la décision qui distingue ce bouton d'une perte de données déguisée en
 * confort.
 */
export async function fillMonth(args: {
  userId: string
  lineId: string
  /** 'YYYY-MM' */
  month: string
  /** 'YYYY-MM-DD' */
  today: string
}): Promise<FillReport> {
  await assertAffecte(args.userId, args.lineId)

  const vide: FillReport = { poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: false }

  // Le verrou se vérifie avant la boucle : le constater au troisième jour
  // laisserait deux journées écrites sur un mois validé.
  if (await isMonthLocked(args.userId, args.lineId, args.month)) {
    return { ...vide, verrouille: true }
  }

  const settings = await getSettings()
  const ouvres = buildMonthDays(args.month, settings.workingDays, settings.holidays).filter(
    (d) => d.isWorking && !d.isHoliday,
  )

  const { start, end } = monthBounds(args.month)
  const existantes = await prisma.timeEntry.findMany({
    where: { userId: args.userId, lineId: args.lineId, date: { gte: start, lt: end } },
    select: { date: true },
  })
  const dejaSaisies = new Set(existantes.map((e) => toIsoDate(e.date)))

  const report: FillReport = { ...vide }

  for (const jour of ouvres) {
    if (dejaSaisies.has(jour.date)) {
      report.dejaSaisis++
      continue
    }

    const resultat = await applyCellState({
      userId: args.userId,
      lineId: args.lineId,
      date: jour.date,
      kind: jour.date >= args.today ? 'PREVISIONNEL' : 'REALISE',
      state: { kind: 'JOURNEE' },
    })

    if (resultat.ok) {
      report.poses++
    } else if (resultat.reason === 'CAPACITE') {
      report.sautesCapacite++
    } else if (resultat.reason === 'VERROUILLE') {
      // Le verrou a été posé pendant la boucle : on s'arrête là plutôt que de
      // continuer à se faire refuser jour après jour.
      return { ...report, verrouille: true }
    } else {
      throw new Error(`Remplissage impossible le ${jour.date} : ${resultat.reason}.`)
    }
  }

  return report
}

/** Retire les saisies du mois pour la prestation sélectionnée, elle seule. */
export async function clearMonth(args: {
  userId: string
  lineId: string
  month: string
}): Promise<ClearReport> {
  await assertAffecte(args.userId, args.lineId)

  if (await isMonthLocked(args.userId, args.lineId, args.month)) {
    return { supprimees: 0, verrouille: true }
  }

  const { start, end } = monthBounds(args.month)
  const { count } = await prisma.timeEntry.deleteMany({
    where: { userId: args.userId, lineId: args.lineId, date: { gte: start, lt: end } },
  })

  return { supprimees: count, verrouille: false }
}
