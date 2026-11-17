import { prisma } from '@/db/client'
import { renderPdf } from '@/core/pdf/writer'
import { buildPlanningDocument, type PlanningDocument } from '@/core/planning/document'
import { layoutPlanningDocument } from '@/core/planning/layout'
import { erreurDePeriode, type Periode } from '@/core/planning/periode'

/** Ce que le planning couvre : la prestation choisie, ou toute la mission. */
export type PerimetrePlanning = 'PRESTATION' | 'MISSION'

export interface PlanningPdf {
  fileName: string
  bytes: Uint8Array
  document: PlanningDocument
}

/** Une période refusée : la route en fait un 400, pas un 404. */
export class PeriodeInvalide extends Error {}

/**
 * Même réduction que `nomFichierCra` : ce nom part dans un en-tête
 * `Content-Disposition`, où un guillemet laissé par un libellé client
 * refermerait la valeur.
 */
function morceau(brut: string): string {
  return brut
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function nomFichierPlanning(clientNom: string, missionLabel: string, periode: Periode): string {
  return `Planning-${morceau(clientNom)}-${morceau(missionLabel)}-${periode.du}-au-${periode.au}.pdf`
}

/**
 * Compose le planning d'une prestation — ou de toute sa mission — sur une
 * période.
 *
 * Le scope tient en une condition : la prestation doit être **affectée** à
 * l'utilisateur, et seules ses propres saisies sont lues. Une prestation
 * inconnue et celle d'un autre consultant lèvent la même erreur.
 *
 * Réalisé et prévisionnel sont lus ensemble : un planning envoyé en cours de
 * mission montre les jours passés comme les jours à venir.
 */
export async function buildPlanningPdf(
  userId: string,
  args: { lineId: string; perimetre: PerimetrePlanning; periode: Periode; aujourdhui: string },
): Promise<PlanningPdf> {
  const erreur = erreurDePeriode(args.periode)
  if (erreur !== null) throw new PeriodeInvalide(erreur)

  const ligne = await prisma.missionLine.findFirstOrThrow({
    where: { id: args.lineId, assignments: { some: { userId } } },
    select: {
      id: true,
      label: true,
      missionId: true,
      mission: { select: { label: true, client: { select: { name: true } } } },
    },
  })

  const lignes =
    args.perimetre === 'MISSION'
      ? await prisma.missionLine.findMany({
          where: { missionId: ligne.missionId, assignments: { some: { userId } } },
          select: { id: true },
        })
      : [{ id: ligne.id }]

  const saisies = await prisma.timeEntry.findMany({
    where: {
      userId,
      lineId: { in: lignes.map((l) => l.id) },
      date: {
        gte: new Date(`${args.periode.du}T00:00:00.000Z`),
        lte: new Date(`${args.periode.au}T00:00:00.000Z`),
      },
    },
    orderBy: { date: 'asc' },
    select: { date: true, minutes: true, minutesParJour: true, startMinute: true },
  })

  const document = buildPlanningDocument({
    clientNom: ligne.mission.client.name,
    missionLabel: ligne.mission.label,
    prestationLabel: args.perimetre === 'MISSION' ? '' : ligne.label,
    periode: args.periode,
    editeLe: args.aujourdhui,
    saisies: saisies.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      minutes: s.minutes,
      minutesParJour: s.minutesParJour,
      startMinute: s.startMinute,
    })),
  })

  return {
    fileName: nomFichierPlanning(ligne.mission.client.name, ligne.mission.label, args.periode),
    bytes: renderPdf(layoutPlanningDocument(document)),
    document,
  }
}
