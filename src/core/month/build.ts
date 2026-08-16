import type { MinutesAuFacteur } from '../time/units'

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

/**
 * Saisies d'un mois regroupées par jour, toutes lignes confondues.
 *
 * Volontairement **pas** une somme de minutes : chaque saisie porte le facteur
 * de conversion figé à son écriture, et des minutes écrites à 420 min/jour ne
 * s'additionnent pas à des minutes écrites à 600. Écraser le facteur ici
 * donnerait à la ligne de totaux un chiffre — et un dépassement — que le
 * contrôle de capacité du service ne reconnaîtrait pas. C'est
 * `centiemesParFacteur` (affichage) et `depasseCapacite` (comparaison) qui
 * savent totaliser un tel groupe.
 */
export function saisiesParJour(
  entries: ReadonlyArray<{ date: string } & MinutesAuFacteur>,
): Map<string, MinutesAuFacteur[]> {
  const parJour = new Map<string, MinutesAuFacteur[]>()
  for (const e of entries) {
    const bucket = parJour.get(e.date)
    const saisie = { minutes: e.minutes, minutesParJour: e.minutesParJour }
    if (bucket === undefined) parJour.set(e.date, [saisie])
    else bucket.push(saisie)
  }
  return parJour
}

function padYear(n: number): string {
  return n < 0 ? `-${String(-n).padStart(4, '0')}` : String(n).padStart(4, '0')
}

/** Décale un mois 'YYYY-MM' de `delta` mois, positif ou négatif. */
export function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const offset = year * 12 + (m - 1) + delta
  const outYear = Math.floor(offset / 12)
  // Modulo positif : le '%' de JS rend un reste négatif quand `offset` l'est
  // (ex. -1 % 12 === -1), ce qui produirait un mois hors de [1,12].
  const outMonth = (((offset % 12) + 12) % 12) + 1
  return `${padYear(outYear)}-${String(outMonth).padStart(2, '0')}`
}
