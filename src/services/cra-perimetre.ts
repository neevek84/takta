/**
 * Les lectures qui dépendent de ce qu'un CRA couvre — toute sa mission, ou une
 * seule prestation (`@/core/cra/perimetre`).
 *
 * Une seule écriture de chacune : la génération, le PDF, la synthèse, le push
 * Dolibarr et le verrou de la saisie doivent tous voir le même périmètre. Une
 * copie par appelant divergerait au premier défaut corrigé d'un seul côté — et
 * le PDF signé ne dirait plus ce que Dolibarr facture.
 */
import { prisma } from '@/db/client'
import type { Prisma } from '@prisma/client'
import { couvreLaLigne, TOUTE_LA_MISSION } from '@/core/cra/perimetre'
import { isLocked } from '@/core/cra/state-machine'
import type { CraStatus } from '@/core/types'

export interface PerimetreCra {
  missionId: string
  /** `Cra.lineId` : vide pour toute la mission */
  lineId: string
}

/** La clé d'un périmètre dans les lectures de lot. */
export function clePerimetre(p: PerimetreCra): string {
  return `${p.missionId}|${p.lineId}`
}

/**
 * Le filtre des saisies qu'un CRA couvre. La mission reste dans la clause même
 * pour une prestation : un `lineId` d'une autre mission ne doit rien ramener.
 */
export function saisiesDuPerimetre(p: PerimetreCra): Prisma.TimeEntryWhereInput {
  return p.lineId === TOUTE_LA_MISSION
    ? { line: { missionId: p.missionId } }
    : { lineId: p.lineId, line: { missionId: p.missionId } }
}

/**
 * La saisie de cette prestation, ce mois-ci, est-elle fermée ?
 *
 * Oui dès qu'**un** CRA qui la couvre est fermé : celui de la prestation, ou
 * celui de toute la mission. Les deux peuvent coexister sur des mois
 * différents quand la mission a changé de réglage — un mois envoyé ou validé
 * pour toute la mission le reste pour chacune de ses prestations.
 */
export async function moisFermePourLaLigne(
  userId: string,
  lineId: string,
  month: string,
): Promise<boolean> {
  const line = await prisma.missionLine.findUnique({
    where: { id: lineId },
    select: { missionId: true },
  })
  if (line === null) return false

  const cras = await prisma.cra.findMany({
    where: {
      missionId: line.missionId,
      userId,
      month: new Date(`${month.slice(0, 7)}-01T00:00:00.000Z`),
      lineId: { in: [TOUTE_LA_MISSION, lineId] },
    },
    select: { lineId: true, status: true },
  })
  return cras.some((c) => couvreLaLigne(c.lineId, lineId) && isLocked(c.status as CraStatus))
}
