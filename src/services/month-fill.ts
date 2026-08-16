import { prisma } from '@/db/client'
import { buildMonthDays } from '@/core/month/build'
import type { ClearReport, FillReport } from '@/core/saisie/report'
import { getSettings } from './settings'
import { applyCellState, isMonthLocked } from './cells'
import { enqueueTimeEntry } from './sync/outbox'
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
 *
 * **L'unité atomique est la journée, pas le mois.** Chaque jour entre en file
 * dans la transaction qui l'écrit — celle qu'`applyCellState` ouvre déjà — et
 * jamais dans une transaction unique tenue ouverte sur trente et un jours.
 * Trois raisons, dans cet ordre :
 *
 * 1. le compte rendu est **déjà partiel** par contrat (`poses`,
 *    `sautesCapacite`, `dejaSaisis`, arrêt sur `verrouille`) : une transaction
 *    de mois annulerait vingt et un jours posés parce que le vingt-deuxième
 *    manque de capacité, ce qui n'est pas ce que ce bouton promet ;
 * 2. le défaut qu'on corrige est *une saisie sans sa ligne en file*, et cette
 *    paire-là est bien couverte par la transaction de la journée ;
 * 3. une transaction interactive de trente et une écritures verrouille la base
 *    entière sous SQLite ; la tâche 6 signalait déjà l'allongement de la
 *    fenêtre de verrou de `saveEntry` sans l'avoir mesuré sous charge — ce
 *    n'est pas le moment de la multiplier par trente.
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
  // laisserait deux journées écrites sur un mois validé. C'est aussi la
  // seule vérification du verrou quand le mois n'a aucun jour ouvré réglé —
  // la boucle ci-dessous ne s'exécute alors jamais, et ne pourrait pas le
  // détecter à sa place (voir le test « signale le verrou même sur un mois
  // sans aucun jour ouvré réglé »).
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

/**
 * Retire les saisies du mois pour la prestation sélectionnée, elle seule.
 *
 * Le mois entier tient dans **une** transaction, contrairement au remplissage :
 * le vidage était déjà un `deleteMany` unique, donc tout ou rien par nature, et
 * `supprimees` ne serait plus vrai s'il pouvait rendre un compte partiel. Les
 * mises en file suivent la suppression qu'elles décrivent — laisser vingt
 * journées effacées en base dont l'agenda garderait les blocs serait exactement
 * le mensonge que ce lot existe pour empêcher.
 */
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
  const portee = { userId: args.userId, lineId: args.lineId, date: { gte: start, lt: end } }

  const supprimees = await prisma.$transaction(async (tx) => {
    // Relevés avant la suppression : un `deleteMany` ne rend qu'un compte, et
    // la file a besoin de l'identifiant de chaque saisie retirée.
    const cibles = await tx.timeEntry.findMany({ where: portee, select: { id: true } })
    if (cibles.length === 0) return 0

    const { count } = await tx.timeEntry.deleteMany({ where: portee })
    for (const cible of cibles) {
      await enqueueTimeEntry(tx, { userId: args.userId, entryId: cible.id, operation: 'DELETE' })
    }

    return count
  })

  return { supprimees, verrouille: false }
}
