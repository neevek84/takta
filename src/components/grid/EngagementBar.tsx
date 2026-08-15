'use client'

import { computeEngagement } from '@/core/engagement/compute'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals } from '@/services/time-entries'
import { SEGMENT_PREVU, SEGMENT_REALISE } from '@/components/ui/SegmentLegend'

/**
 * Bandeau d'engagement d'une ligne de prestation.
 *
 * `totals` est un cumul **sur toute la durée de la ligne**, jamais les saisies
 * du seul mois affiché : l'engagement se consomme d'un mois sur l'autre, et le
 * comparer aux jours vendus du contrat entier n'a de sens qu'à ce prix.
 *
 * `totals` porte, pour chaque saisie regroupée, le facteur de conversion figé
 * à son écriture — jamais le facteur courant de `line`. Le convertir avec
 * `line.minutesParJour` réinterpréterait le réalisé/prévisionnel à chaque
 * changement de réglage, exactement ce que ce lot corrige ailleurs.
 */
export function EngagementBar({
  line,
  totals,
}: {
  line: LineForGrid
  totals: LineEngagementTotals
}) {
  const e = computeEngagement({
    venduCentiemes: line.soldCentiemes,
    entries: totals,
  })

  const pct = (v: number) => (e.venduCentiemes === 0 ? 0 : (v / e.venduCentiemes) * 100)

  return (
    <div data-testid={`engagement-${line.id}`} className="flex items-center gap-3 text-xs">
      <div className="h-2 w-40 overflow-hidden rounded-sm bg-off-strong">
        {/* Le prévisionnel se hachure : la teinte plus claire seule ne le
            distinguerait pas du réalisé en vision monochrome. Le nom des deux
            segments est porté par la légende visible de la grille, une fois
            pour toutes les lignes — pas par ces `title`, qui n'existent qu'à
            la souris. */}
        <div className="flex h-full">
          <div
            data-segment="realise"
            title="Réalisé"
            className={SEGMENT_REALISE}
            style={{ width: `${pct(e.realiseCentiemes)}%` }}
          />
          <div
            data-segment="prevu"
            title="Prévisionnel"
            className={SEGMENT_PREVU}
            style={{ width: `${pct(e.prevuCentiemes)}%` }}
          />
        </div>
      </div>
      <span className="text-muted">
        {e.venduCentiemes / 100} vendus · {e.realiseCentiemes / 100} réalisés ·{' '}
        {e.prevuCentiemes / 100} prévus · {e.resteCentiemes / 100} restants
      </span>
      {e.depassementCentiemes > 0 && (
        <span className="text-warning-ink">dépassement de {e.depassementCentiemes / 100} j</span>
      )}
    </div>
  )
}
