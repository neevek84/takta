const MINUTES_PER_DAY = 1440

export interface Slot {
  id: string
  label: string
  /** minutes depuis minuit, 0-1439 */
  startMinute: number
  /** minutes depuis minuit, 0-1439 */
  endMinute: number
  /** valeur du créneau en centièmes de jour */
  centiemes: number
}

export function crossesMidnight(slot: Slot): boolean {
  return slot.endMinute <= slot.startMinute
}

export function slotDurationMinutes(slot: Slot): number {
  return crossesMidnight(slot)
    ? MINUTES_PER_DAY - slot.startMinute + slot.endMinute
    : slot.endMinute - slot.startMinute
}

export function slotInterval(slot: Slot, date: Date): { start: Date; end: Date } {
  const start = new Date(date.getTime() + slot.startMinute * 60_000)
  const end = new Date(start.getTime() + slotDurationMinutes(slot) * 60_000)
  return { start, end }
}
