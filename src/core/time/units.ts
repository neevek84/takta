import type { DisplayUnit } from '../types'

export function minutesToCentiemes(minutes: number, minutesParJour: number): number {
  return Math.round((minutes / minutesParJour) * 100)
}

export function centiemesToMinutes(centiemes: number, minutesParJour: number): number {
  return Math.round((centiemes / 100) * minutesParJour)
}

function formatDays(minutes: number, minutesParJour: number): string {
  const days = minutes / minutesParJour
  const rounded = Math.round(days * 100) / 100
  return String(rounded).replace('.', ',')
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

export function formatQuantity(
  minutes: number,
  unit: DisplayUnit,
  minutesParJour: number,
): string {
  if (minutes === 0) return ''
  return unit === 'HEURE' ? formatHours(minutes) : formatDays(minutes, minutesParJour)
}

export function parseQuantity(
  input: string,
  unit: DisplayUnit,
  minutesParJour: number,
): number | null {
  const raw = input.trim()
  if (raw === '') return 0

  if (unit === 'HEURE') {
    const hm = /^(\d+)\s*h\s*(\d{1,2})?$/i.exec(raw)
    if (hm) {
      const h = Number(hm[1])
      const m = hm[2] === undefined ? 0 : Number(hm[2])
      if (m > 59) return null
      return h * 60 + m
    }
    const n = Number(raw.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return null
    return Math.round(n * 60)
  }

  const n = Number(raw.replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * minutesParJour)
}
