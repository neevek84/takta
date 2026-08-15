import type { CapacityMode } from '../types'

export type CapacityVerdict =
  | { ok: true }
  | { ok: false; severity: 'warn' | 'block'; totalMinutes: number; capacityMinutes: number }

export function checkCapacity(args: {
  existingMinutes: number
  addedMinutes: number
  capacityMinutes: number
  mode: CapacityMode
}): CapacityVerdict {
  if (args.mode === 'DESACTIVE') return { ok: true }

  const totalMinutes = args.existingMinutes + args.addedMinutes
  if (totalMinutes <= args.capacityMinutes) return { ok: true }

  return {
    ok: false,
    severity: args.mode === 'BLOCAGE' ? 'block' : 'warn',
    totalMinutes,
    capacityMinutes: args.capacityMinutes,
  }
}
