import { prisma } from '@/db/client'
import { resolveMinutesParJour } from '@/core/rates/cascade'
import { isLocked } from '@/core/cra/state-machine'
import { getSettings } from './settings'
import { appendAudit, actorOf } from './audit'
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
 *
 * @param globalOverride durée de journée **hypothétique**, pour répondre à
 * « que se passerait-il si je reprenais la valeur de Dolibarr ? » avant d'avoir
 * enregistré quoi que ce soit. Sans lui, l'aperçu affiché avant confirmation
 * annoncerait toujours zéro saisie concernée, ce qui viderait l'avertissement
 * de son sens. Il ne sert qu'à *simuler* : rien n'est écrit sur ce chemin, et
 * une surcharge de prestation, de mission ou de client continue de l'emporter
 * sur lui comme sur le réglage réel.
 */
async function candidats(userId: string, globalOverride?: number): Promise<Candidate[]> {
  const settings = await getSettings()
  const global = globalOverride ?? settings.minutesParJour

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
      global,
    })
    if (cible === e.minutesParJour) continue

    const cle = `${e.line.missionId}|${e.date.toISOString().slice(0, 7)}`
    out.push({ id: e.id, actuel: e.minutesParJour, cible, verrouille: verrous.has(cle) })
  }
  return out
}

export async function previewRecalibration(
  userId: string,
  globalMinutesParJourHypothetique?: number,
): Promise<{ concernees: number; verrouillees: number }> {
  const liste = await candidats(userId, globalMinutesParJourHypothetique)
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

  // Un réétalonnage qui ne touche rien n'est pas un acte : le consigner
  // remplirait le journal de non-événements à chaque passage sur l'écran.
  if (aTraiter.length > 0) {
    await appendAudit({
      ...(await actorOf(userId)),
      action: 'reetalonnage.effectue',
      entityType: 'Settings',
      entityId: 'singleton',
      payload: {
        recalibrees: aTraiter.length,
        sauteesVerrouillees: liste.length - aTraiter.length,
        entryIds: aTraiter.map((c) => c.id),
      },
    })
  }

  return {
    recalibrees: aTraiter.length,
    sauteesVerrouillees: liste.length - aTraiter.length,
  }
}
