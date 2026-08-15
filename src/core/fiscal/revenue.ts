/**
 * Convention « cumuler puis convertir », alignée sur `computeEngagement` :
 * on cumule les minutes, puis on ne convertit qu'une seule fois. Un arrondi
 * par entrée (l'ancien comportement) dérive de façon systématique dès que
 * `minutes / minutesParJour` ne tombe pas juste et que l'appelant passe de
 * nombreuses entrées pour une même ligne.
 *
 * Le cumul n'a de sens qu'à **facteur constant** : le facteur est désormais
 * porté par chaque saisie (figé à son écriture), et des minutes valorisées à
 * 420/jour ne s'additionnent pas à des minutes valorisées à 480/jour. On
 * cumule donc par couple (ligne, facteur), avec un seul arrondi par groupe.
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
  entries: ReadonlyArray<{ lineId: string; minutes: number; minutesParJour: number }>,
  lines: ReadonlyArray<{ id: string; tjmCents: number }>,
): number {
  const tjmById = new Map(lines.map((l) => [l.id, l.tjmCents]))

  // Cumul des minutes par (ligne, facteur) : un seul arrondi par groupe.
  const parGroupe = new Map<string, { lineId: string; facteur: number; minutes: number }>()
  for (const e of entries) {
    // Entrée orpheline, ou facteur inexploitable : contribue zéro plutôt que
    // de faire tomber l'écran.
    if (!tjmById.has(e.lineId) || e.minutesParJour <= 0) continue
    const cle = `${e.lineId}|${e.minutesParJour}`
    const g = parGroupe.get(cle) ?? { lineId: e.lineId, facteur: e.minutesParJour, minutes: 0 }
    g.minutes += e.minutes
    parGroupe.set(cle, g)
  }

  let cents = 0
  for (const g of parGroupe.values()) {
    cents += Math.round((g.minutes * (tjmById.get(g.lineId) ?? 0)) / g.facteur)
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
