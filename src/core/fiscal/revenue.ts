export function caFromEntries(
  entries: ReadonlyArray<{ lineId: string; minutes: number }>,
  lines: ReadonlyArray<{ id: string; tjmCents: number; minutesParJour: number }>,
): number {
  const byId = new Map(lines.map((l) => [l.id, l]))
  let cents = 0

  for (const e of entries) {
    const line = byId.get(e.lineId)
    // Entrée orpheline : contribue zéro plutôt que de faire tomber l'écran.
    if (line === undefined || line.minutesParJour <= 0) continue
    cents += Math.round((e.minutes * line.tjmCents) / line.minutesParJour)
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
