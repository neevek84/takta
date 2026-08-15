import { prisma } from '@/db/client'
import type { Slot } from '@/core/time/slots'
import type { CapacityMode, DisplayUnit, EngagementSource } from '@/core/types'

export const DEFAULT_SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
  { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 },
]

export interface AppSettings {
  minutesParJour: number
  capacityMode: CapacityMode
  capacityCentiemes: number
  workingDays: number[]
  slots: Slot[]
  /** dates ISO 'YYYY-MM-DD' */
  holidays: string[]
  defaultDisplayUnit: DisplayUnit
  defaultEngagementSource: EngagementSource
}

function parseDays(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
}

type Row = Awaited<ReturnType<typeof prisma.settings.upsert>>

function toAppSettings(row: Row): AppSettings {
  const slots = JSON.parse(row.slotsJson) as Slot[]
  return {
    minutesParJour: row.minutesParJour,
    capacityMode: row.capacityMode as CapacityMode,
    capacityCentiemes: row.capacityCentiemes,
    workingDays: parseDays(row.workingDays),
    slots: slots.length > 0 ? slots : DEFAULT_SLOTS,
    holidays: JSON.parse(row.holidaysJson) as string[],
    defaultDisplayUnit: row.defaultDisplayUnit as DisplayUnit,
    defaultEngagementSource: row.defaultEngagementSource as EngagementSource,
  }
}

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', slotsJson: JSON.stringify(DEFAULT_SLOTS) },
    update: {},
  })
  return toAppSettings(row)
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  await getSettings() // garantit l'existence du singleton

  const row = await prisma.settings.update({
    where: { id: 'singleton' },
    data: {
      ...(patch.minutesParJour !== undefined && { minutesParJour: patch.minutesParJour }),
      ...(patch.capacityMode !== undefined && { capacityMode: patch.capacityMode }),
      ...(patch.capacityCentiemes !== undefined && { capacityCentiemes: patch.capacityCentiemes }),
      ...(patch.workingDays !== undefined && { workingDays: patch.workingDays.join(',') }),
      ...(patch.slots !== undefined && { slotsJson: JSON.stringify(patch.slots) }),
      ...(patch.holidays !== undefined && { holidaysJson: JSON.stringify(patch.holidays) }),
      ...(patch.defaultDisplayUnit !== undefined && { defaultDisplayUnit: patch.defaultDisplayUnit }),
      ...(patch.defaultEngagementSource !== undefined && {
        defaultEngagementSource: patch.defaultEngagementSource,
      }),
    },
  })
  return toAppSettings(row)
}
