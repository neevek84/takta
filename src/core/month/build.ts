export interface MonthDay {
  /** 'YYYY-MM-DD' */
  date: string
  /** 1 = lundi ... 7 = dimanche */
  dayOfWeek: number
  isWorking: boolean
  isHoliday: boolean
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function buildMonthDays(
  month: string,
  workingDays: number[],
  holidays: string[],
): MonthDay[] {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const holidaySet = new Set(holidays)

  const out: MonthDay[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${y}-${pad(m)}-${pad(d)}`
    const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = dimanche
    const dayOfWeek = js === 0 ? 7 : js
    out.push({
      date,
      dayOfWeek,
      isWorking: workingDays.includes(dayOfWeek),
      isHoliday: holidaySet.has(date),
    })
  }
  return out
}

export function dailyTotals(
  entries: ReadonlyArray<{ date: string; minutes: number }>,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const e of entries) {
    totals.set(e.date, (totals.get(e.date) ?? 0) + e.minutes)
  }
  return totals
}
