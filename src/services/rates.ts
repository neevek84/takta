import { prisma } from '@/db/client'
import { resolveMinutesParJour } from '@/core/rates/cascade'
import { isLocked } from '@/core/cra/state-machine'
import { getSettings } from './settings'
import type { CraStatus } from '@/core/types'

interface Candidate {
  id: string
  actuel: number
  cible: number
  verrouille: boolean
}

/**
 * Liste les saisies dont le facteur figé diffère du facteur que la cascade
 * donnerait aujourd'hui, en marquant celles qui appartiennent à un mois validé.
 */
async function candidats(userId: string): Promise<Candidate[]> {
  const settings = await getSettings()

  const entries = await prisma.timeEntry.findMany({
    where: { userId },
    select: {
      id: true,
      date: true,
      minutesParJour: true,
      line: {
        select: {
          missionId: true,
          minutesParJour: true,
          mission: {
            select: { minutesParJour: true, client: { select: { minutesParJour: true } } },
          },
        },
      },
    },
  })

  if (entries.length === 0) return []

  const cras = await prisma.cra.findMany({
    where: { userId },
    select: { missionId: true, month: true, status: true },
  })
  const verrous = new Set(
    cras
      .filter((c) => isLocked(c.status as CraStatus))
      .map((c) => `${c.missionId}|${c.month.toISOString().slice(0, 7)}`),
  )

  const out: Candidate[] = []
  for (const e of entries) {
    const cible = resolveMinutesParJour({
      line: e.line.minutesParJour,
      mission: e.line.mission.minutesParJour,
      client: e.line.mission.client.minutesParJour,
      global: settings.minutesParJour,
    })
    if (cible === e.minutesParJour) continue

    const cle = `${e.line.missionId}|${e.date.toISOString().slice(0, 7)}`
    out.push({ id: e.id, actuel: e.minutesParJour, cible, verrouille: verrous.has(cle) })
  }
  return out
}

export async function previewRecalibration(
  userId: string,
): Promise<{ concernees: number; verrouillees: number }> {
  const liste = await candidats(userId)
  return {
    concernees: liste.filter((c) => !c.verrouille).length,
    verrouillees: liste.filter((c) => c.verrouille).length,
  }
}

export async function recalibrateOpenMonths(
  userId: string,
): Promise<{ recalibrees: number; sauteesVerrouillees: number }> {
  const liste = await candidats(userId)
  const aTraiter = liste.filter((c) => !c.verrouille)

  for (const c of aTraiter) {
    await prisma.timeEntry.update({
      where: { id: c.id },
      data: { minutesParJour: c.cible },
    })
  }

  return {
    recalibrees: aTraiter.length,
    sauteesVerrouillees: liste.length - aTraiter.length,
  }
}
