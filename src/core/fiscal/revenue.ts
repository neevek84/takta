/**
 * Convention « cumuler puis convertir », alignée sur `computeEngagement` :
 * on cumule les minutes par ligne, puis on ne convertit qu'une seule fois
 * par ligne. Un arrondi par entrée (l'ancien comportement) dérive de façon
 * systématique dès que `minutes / minutesParJour` ne tombe pas juste et que
 * l'appelant passe de nombreuses entrées pour une même ligne.
 *
 * Écart résiduel : cette fonction ne cumule qu'à l'intérieur d'un seul
 * appel. `services/charge.ts` l'appelle une fois par mois (pour
 * `monthTotals.caCents`) et une fois pour tout l'exercice (pour
 * `realiseCents`/`prevuCents`) : chaque appel arrondit indépendamment, donc
 * la somme des `monthTotals.caCents` peut différer de quelques centimes du
 * total exercice. C'est un choix de découpage par l'appelant, pas quelque
 * chose que cette fonction pure peut résoudre sans changer sa signature.
 */
export function caFromEntries(
  entries: ReadonlyArray<{ lineId: string; minutes: number }>,
  lines: ReadonlyArray<{ id: string; tjmCents: number; minutesParJour: number }>,
): number {
  const byId = new Map(lines.map((l) => [l.id, l]))
  const minutesByLineId = new Map<string, number>()

  for (const e of entries) {
    const line = byId.get(e.lineId)
    // Entrée orpheline : contribue zéro plutôt que de faire tomber l'écran.
    if (line === undefined || line.minutesParJour <= 0) continue
    minutesByLineId.set(e.lineId, (minutesByLineId.get(e.lineId) ?? 0) + e.minutes)
  }

  let cents = 0
  for (const [lineId, minutes] of minutesByLineId) {
    const line = byId.get(lineId)!
    cents += Math.round((minutes * line.tjmCents) / line.minutesParJour)
  }

  return cents
}

export interface ExerciceProgress {
  objectifCents: number
  realiseCents: number
  prevuCents: number
  /** plafonné à zéro */
  resteAVendreCents: number
  depassementCents: number
  /** ratio d'affichage, jamais persisté */
  tauxCouverture: number
}

export function exerciceProgress(
  objectifCents: number,
  realiseCents: number,
  prevuCents: number,
): ExerciceProgress {
  const solde = objectifCents - realiseCents - prevuCents

  return {
    objectifCents,
    realiseCents,
    prevuCents,
    resteAVendreCents: Math.max(0, solde),
    depassementCents: Math.max(0, -solde),
    tauxCouverture: objectifCents === 0 ? 0 : (realiseCents + prevuCents) / objectifCents,
  }
}

export function tjmMoyenPondere(
  lines: ReadonlyArray<{ tjmCents: number; soldCentiemes: number }>,
): number | null {
  let poids = 0
  let cumul = 0

  for (const l of lines) {
    poids += l.soldCentiemes
    cumul += l.tjmCents * l.soldCentiemes
  }

  return poids === 0 ? null : Math.round(cumul / poids)
}

export function resteEnCentiemes(
  resteAVendreCents: number,
  tjmMoyenCents: number | null,
): number | null {
  if (tjmMoyenCents === null || tjmMoyenCents <= 0) return null
  return Math.round((resteAVendreCents * 100) / tjmMoyenCents)
}
