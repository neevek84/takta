import type { DisplayUnit } from '../types'

export function minutesToCentiemes(minutes: number, minutesParJour: number): number {
  return Math.round((minutes / minutesParJour) * 100)
}

export function centiemesToMinutes(centiemes: number, minutesParJour: number): number {
  return Math.round((centiemes / 100) * minutesParJour)
}

/** Des minutes et le facteur de conversion sous lequel elles ont été écrites. */
export interface MinutesAuFacteur {
  minutes: number
  /** durée d'une journée figée à l'écriture de ces minutes */
  minutesParJour: number
}

/**
 * Cumul des minutes par facteur de conversion.
 *
 * « Cumuler les minutes, convertir une fois » — mais seulement à facteur
 * constant : des minutes écrites à 420/jour et à 480/jour ne s'additionnent
 * pas. Cumuler d'abord évite aussi qu'une journée pleine découpée en trois
 * saisies dépasse les 100 centièmes par accumulation d'arrondis.
 */
export function minutesParFacteur(
  entries: ReadonlyArray<MinutesAuFacteur>,
): Map<number, number> {
  const parFacteur = new Map<number, number>()
  for (const e of entries) {
    parFacteur.set(e.minutesParJour, (parFacteur.get(e.minutesParJour) ?? 0) + e.minutes)
  }
  return parFacteur
}

function convertirParGroupe(
  entries: ReadonlyArray<MinutesAuFacteur>,
  convertir: (minutes: number, facteur: number) => number,
): number {
  let total = 0
  for (const [facteur, minutes] of minutesParFacteur(entries)) {
    // Facteur inexploitable : contribue zéro plutôt que de propager un
    // Infinity jusqu'à l'écran ou jusqu'à une comparaison de capacité.
    if (facteur <= 0) continue
    total += convertir(minutes, facteur)
  }
  return total
}

/**
 * Total en centièmes de jour d'un ensemble de saisies, chacune convertie sous
 * le facteur figé à son écriture. On groupe par facteur, on convertit chaque
 * groupe, on somme les centièmes.
 *
 * **Unité d'affichage.** Le centième est ce qu'un écran montre — « 1,04 j » —
 * et l'arrondi qui va avec est le prix de cet affichage. Pour *comparer* deux
 * charges, voir `millicentiemesParFacteur` : arrondir avant de comparer laisse
 * passer tout ce qui tient dans un demi-centième.
 *
 * Point de passage unique du domaine : l'engagement, la capacité et la ligne
 * de totaux en dépendent tous, précisément pour qu'ils ne puissent pas
 * afficher « 1,40 j ici, 1,43 j là » sur un même écran.
 */
export function centiemesParFacteur(entries: ReadonlyArray<MinutesAuFacteur>): number {
  return convertirParGroupe(entries, minutesToCentiemes)
}

/** Un centième de jour vaut mille millicentièmes ; un jour en vaut 100 000. */
export const MILLICENTIEMES_PAR_CENTIEME = 1000

/**
 * Le même total, dans une unité mille fois plus fine : le millicentième de
 * jour, soit un cent-millième de journée.
 *
 * C'est l'unité des **comparaisons**, quand celle des affichages est le
 * centième. Une minute y pèse `100 000 / minutesParJour` unités — au moins 69
 * même sur une journée de 24 heures — quand l'arrondi de chaque groupe coûte
 * au plus une demi-unité. Un dépassement d'une minute est donc toujours vu,
 * là où le centième le noyait : à 480 minutes par jour, un centième vaut
 * 4,8 minutes, et près de deux minutes et demie s'y perdaient.
 *
 * La règle du facteur constant vaut ici comme ailleurs : on groupe par
 * facteur, on convertit chaque groupe, on somme. Jamais la conversion d'une
 * somme de minutes issues de facteurs différents.
 */
export function millicentiemesParFacteur(entries: ReadonlyArray<MinutesAuFacteur>): number {
  return convertirParGroupe(entries, (minutes, facteur) =>
    Math.round((minutes / facteur) * 100 * MILLICENTIEMES_PAR_CENTIEME),
  )
}

/**
 * Centièmes de jour → jours affichés, virgule décimale. Vide à zéro, comme
 * `formatQuantity` : une journée sans saisie ne montre pas un « 0 ».
 */
export function formatJours(centiemes: number): string {
  if (centiemes === 0) return ''
  return String(centiemes / 100).replace('.', ',')
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
