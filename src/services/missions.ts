import { prisma } from '@/db/client'
import { getSettings } from './settings'
import type { DisplayUnit } from '@/core/types'

export interface LineForGrid {
  id: string
  label: string
  missionLabel: string
  clientName: string
  displayUnit: DisplayUnit
  minutesParJour: number
  soldCentiemes: number
  allowedSlotIds: string[]
}

export async function createMission(args: {
  clientId: string
  label: string
}): Promise<{ id: string }> {
  const m = await prisma.mission.create({
    data: { clientId: args.clientId, label: args.label },
  })
  return { id: m.id }
}

export async function createLine(args: {
  missionId: string
  userId: string
  label: string
  soldCentiemes: number
  tjmCents: number
  displayUnit?: DisplayUnit
  minutesParJour?: number | null
  allowedSlotIds?: string[]
}): Promise<{ id: string }> {
  const settings = await getSettings()

  const line = await prisma.missionLine.create({
    data: {
      missionId: args.missionId,
      label: args.label,
      soldCentiemes: args.soldCentiemes,
      tjmCents: args.tjmCents,
      displayUnit: args.displayUnit ?? settings.defaultDisplayUnit,
      minutesParJour: args.minutesParJour ?? null,
      engagementSource: settings.defaultEngagementSource,
      allowedSlotIds: (args.allowedSlotIds ?? []).join(','),
    },
  })

  // Provision multi-consultants : l'affectation existe toujours, même à un seul.
  await prisma.assignment.create({
    data: { lineId: line.id, userId: args.userId, soldCentiemes: args.soldCentiemes },
  })

  return { id: line.id }
}

export async function listActiveLines(userId: string): Promise<LineForGrid[]> {
  const settings = await getSettings()

  const assignments = await prisma.assignment.findMany({
    where: { userId, line: { archived: false, mission: { archived: false } } },
    include: { line: { include: { mission: { include: { client: true } } } } },
    orderBy: [{ line: { position: 'asc' } }],
  })

  return assignments.map((a) => ({
    id: a.line.id,
    label: a.line.label,
    missionLabel: a.line.mission.label,
    clientName: a.line.mission.client.name,
    displayUnit: a.line.displayUnit as DisplayUnit,
    minutesParJour: a.line.minutesParJour ?? settings.minutesParJour,
    soldCentiemes: a.soldCentiemes,
    allowedSlotIds: a.line.allowedSlotIds === '' ? [] : a.line.allowedSlotIds.split(','),
  }))
}
