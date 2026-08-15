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

interface ChargeLine {
  id: string
  label: string
  soldCentiemes: number
  tjmCents: number
}

/**
 * Convertit un cumul de minutes déjà **groupé par facteur** : un seul arrondi
 * par groupe, comme `centiemesParFacteur` dans `core/engagement/compute`.
 *
 * La convention du lot est « cumuler les minutes, convertir une fois ». Elle ne
 * tient qu'à facteur constant : des minutes valorisées à 420 min/jour et à
 * 480 min/jour ne s'additionnent pas. Un accumulateur de minutes indifférent au
 * facteur produirait un total faux dès qu'un mois mélange deux durées de
 * journée — et convertir chaque saisie séparément ferait dériver l'arrondi
 * (dix saisies d'une heure sur une journée à 420 min donnent 140 centièmes au
 * lieu de 143). En pratique un groupe est presque toujours seul.
 */
function centiemesDuCumul(parFacteur: ReadonlyMap<number, number>): number {
  let centiemes = 0
  for (const [facteur, minutes] of parFacteur) {
    // Facteur inexploitable : contribue zéro plutôt que d'afficher un Infinity.
    if (facteur <= 0) continue
    centiemes += minutesToCentiemes(minutes, facteur)
  }
  return centiemes
}

/** Minuit UTC du premier jour du mois `YYYY-MM`. */
function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`)
}

/** Minuit UTC du premier jour du mois *suivant* `YYYY-MM` (borne exclue). */
function monthEnd(month: string): Date {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  return new Date(Date.UTC(year, m, 1))
}

/**
 * Univers de lignes du plan de charge, pour un utilisateur et un exercice.
 *
 * Ce n'est **pas** `listActiveLines`, qui répond à « sur quoi puis-je saisir
 * aujourd'hui » et exclut donc tout ce qui est archivé. Le plan de charge
 * répond à « qu'ai-je réalisé et planifié sur cet exercice » : le chiffre
 * d'affaires d'un exercice est un fait comptable, il ne disparaît pas parce
 * qu'une mission a été archivée après coup. L'univers retenu est donc :
 *
 *  - les lignes actives affectées à l'utilisateur, même sans aucune saisie —
 *    ce sont elles qui portent un reste à planifier ;
 *  - **plus** les lignes archivées affectées à l'utilisateur qui portent au
 *    moins une de ses saisies **dans l'exercice demandé**.
 *
 * Une ligne archivée sans saisie de l'exercice reste donc absente : l'archivage
 * garde tout son effet sur ce qui est encore à vendre. Le même univers sert aux
 * lignes affichées, aux cellules, aux totaux mensuels et au CA de l'exercice :
 * les dissocier ferait afficher au pied d'une colonne des jours et des euros
 * qu'aucune cellule visible ne justifierait.
 *
 * La requête est écrite ici plutôt que dans `missions.ts` : `listActiveLines`
 * garde sa sémantique de grille de saisie, et le scope `userId` vit dans le
 * service, y compris sur la condition de saisie (`timeEntries.some`).
 */
async function listLinesForFiscalYear(
  userId: string,
  fiscalYear: FiscalYear,
): Promise<ChargeLine[]> {
  const debut = monthStart(fiscalYear.months[0]!)
  const fin = monthEnd(fiscalYear.months[fiscalYear.months.length - 1]!)

  const assignments = await prisma.assignment.findMany({
    where: {
      userId,
      OR: [
        { line: { archived: false, mission: { archived: false } } },
        { line: { timeEntries: { some: { userId, date: { gte: debut, lt: fin } } } } },
      ],
    },
    include: { line: { include: { mission: { include: { client: true } } } } },
    orderBy: [{ line: { position: 'asc' } }],
  })

  // Aucun facteur de conversion n'est lu ici : il est porté par chaque saisie,
  // figé à son écriture. Le rejouer depuis la ligne ou depuis les réglages
  // réinterpréterait tout l'historique dès qu'un réglage change.
  return assignments.map((a) => ({
    id: a.line.id,
    label: `${a.line.mission.client.name} · ${a.line.mission.label} · ${a.line.label}`,
    soldCentiemes: a.soldCentiemes,
    tjmCents: a.line.tjmCents,
  }))
}

export async function buildChargeMatrix(
  userId: string,
  startYear: number,
): Promise<ChargeMatrix> {
  const settings = await getSettings()
  const fiscalYear = fiscalYearFromStartYear(startYear, settings.debutExerciceMois)
  const lines = await listLinesForFiscalYear(userId, fiscalYear)

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
    select: { lineId: true, date: true, minutes: true, kind: true, minutesParJour: true },
  })

  const entries = rows.map((r) => ({
    lineId: r.lineId,
    date: toIsoDate(r.date),
    minutes: r.minutes,
    kind: r.kind as TimeEntryKind,
    minutesParJour: r.minutesParJour,
  }))

  // Les lignes n'apportent plus que leur tarif : le facteur vient des saisies.
  const priced = lines.map((l) => ({ id: l.id, tjmCents: l.tjmCents }))

  const monthTotals = emptyTotals.map(() => ({ centiemes: 0, caCents: 0 }))

  const chargeRows: ChargeRow[] = lines.map((line) => {
    const lineEntries = entries.filter((e) => e.lineId === line.id)

    // Convention du lot : on cumule les **minutes**, puis on convertit une
    // seule fois — la même discipline que `computeEngagement`. Le cumul se
    // fait par (cellule, facteur), car une même ligne peut porter des saisies
    // figées à des durées de journée différentes ; voir `centiemesDuCumul`.
    const realiseParFacteur = fiscalYear.months.map(() => new Map<number, number>())
    const prevuParFacteur = fiscalYear.months.map(() => new Map<number, number>())

    for (const e of lineEntries) {
      const i = monthIndex.get(e.date.slice(0, 7))
      if (i === undefined) continue
      const parFacteur = e.kind === 'REALISE' ? realiseParFacteur[i]! : prevuParFacteur[i]!
      parFacteur.set(e.minutesParJour, (parFacteur.get(e.minutesParJour) ?? 0) + e.minutes)
    }

    const cells: ChargeCell[] = fiscalYear.months.map((_, i) => ({
      realiseCentiemes: centiemesDuCumul(realiseParFacteur[i]!),
      prevuCentiemes: centiemesDuCumul(prevuParFacteur[i]!),
    }))

    // Le total d'une colonne est la somme des cellules déjà converties, et non
    // la conversion d'un cumul de minutes : deux lignes peuvent avoir des
    // journées de durées différentes, leurs minutes ne s'additionnent pas. Le
    // pied de colonne affiche ainsi exactement ce que ses cellules affichent.
    for (const [i, c] of cells.entries()) {
      monthTotals[i]!.centiemes += c.realiseCentiemes + c.prevuCentiemes
    }

    const engagement = computeEngagement({
      venduCentiemes: line.soldCentiemes,
      entries: lineEntries,
    })

    return {
      lineId: line.id,
      label: line.label,
      tjmCents: line.tjmCents,
      cells,
      engagement,
      resteAVendreCents: Math.round((engagement.resteCentiemes * line.tjmCents) / 100),
    }
  })

  // Le CA de l'exercice est la **somme des douze totaux mensuels**, et non un
  // appel global à `caFromEntries` sur les entrées de l'exercice. `caFromEntries`
  // cumule les minutes puis arrondit une fois par ligne, mais seulement à
  // l'intérieur d'un appel : deux découpages différents (par mois / sur
  // l'exercice) arrondissent indépendamment et divergent de quelques centimes.
  // La barre d'exercice et le pied du tableau sont affichés sur le même écran ;
  // ils doivent se sommer exactement.
  let realiseCents = 0
  let prevuCents = 0

  for (const [i, month] of fiscalYear.months.entries()) {
    const ofMonth = entries.filter((e) => e.date.slice(0, 7) === month)
    const moisRealise = caFromEntries(ofMonth.filter((e) => e.kind === 'REALISE'), priced)
    const moisPrevu = caFromEntries(ofMonth.filter((e) => e.kind === 'PREVISIONNEL'), priced)
    monthTotals[i]!.caCents = moisRealise + moisPrevu
    realiseCents += moisRealise
    prevuCents += moisPrevu
  }

  const progress = exerciceProgress(settings.objectifCaExerciceCents, realiseCents, prevuCents)

  const tjmMoyen = tjmMoyenPondere(
    lines.map((l) => ({ tjmCents: l.tjmCents, soldCentiemes: l.soldCentiemes })),
  )

  return {
    fiscalYear,
    rows: chargeRows,
    monthTotals,
    progress,
    resteEnJoursCentiemes: resteEnCentiemes(progress.resteAVendreCents, tjmMoyen),
  }
}
