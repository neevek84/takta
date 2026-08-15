function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

/** Algorithme de Meeus/Jones/Butcher, calendrier grégorien. */
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1

  return iso(new Date(Date.UTC(year, month - 1, day)))
}

export function frenchHolidays(year: number): Array<{ date: string; label: string }> {
  const easter = easterSunday(year)
  const pad = (n: number) => String(n).padStart(2, '0')
  const fixed = (m: number, d: number) => `${year}-${pad(m)}-${pad(d)}`

  const all = [
    { date: fixed(1, 1), label: "Jour de l'an" },
    { date: addDays(easter, 1), label: 'Lundi de Pâques' },
    { date: fixed(5, 1), label: 'Fête du Travail' },
    { date: fixed(5, 8), label: 'Victoire 1945' },
    { date: addDays(easter, 39), label: 'Ascension' },
    { date: addDays(easter, 50), label: 'Lundi de Pentecôte' },
    { date: fixed(7, 14), label: 'Fête nationale' },
    { date: fixed(8, 15), label: 'Assomption' },
    { date: fixed(11, 1), label: 'Toussaint' },
    { date: fixed(11, 11), label: 'Armistice 1918' },
    { date: fixed(12, 25), label: 'Noël' },
  ]

  return all.sort((x, y) => x.date.localeCompare(y.date))
}
