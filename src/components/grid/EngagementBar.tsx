'use client'

import { computeEngagement } from '@/core/engagement/compute'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals } from '@/services/time-entries'
import { SEGMENT_PREVU, SEGMENT_PREVU_BORDURE, SEGMENT_REALISE } from '@/components/ui/SegmentLegend'
import { cn } from '@/lib/cn'

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
 *
 * `pleineLargeur` en fait la **réglette du mois**, posée sous le calendrier à
 * la largeur de la grille. Le défaut est `false` : la vue tableau, qui empile
 * une barre par ligne, garde exactement le rendu qu'elle avait. Rien du calcul
 * ne change dans un cas ni dans l'autre — `computeEngagement` n'est pas touché.
 */
export function EngagementBar({
  line,
  totals,
  pleineLargeur = false,
}: {
  line: LineForGrid
  totals: LineEngagementTotals
  pleineLargeur?: boolean
}) {
  const e = computeEngagement({
    venduCentiemes: line.soldCentiemes,
    entries: totals,
  })

  const pct = (v: number) => (e.venduCentiemes === 0 ? 0 : (v / e.venduCentiemes) * 100)

  return (
    <div
      data-testid={`engagement-${line.id}`}
      className={cn(
        'flex items-center gap-3 text-xs',
        pleineLargeur && 'flex-col items-stretch gap-1',
      )}
    >
      <div
        data-testid={`piste-engagement-${line.id}`}
        className={cn(
          'relative overflow-hidden rounded-sm bg-off-strong',
          'h-2 w-40',
          // `cn()` résout le conflit : ni `h-2` ni `w-40` ne survivent, quel
          // que soit l'ordre d'insertion des règles CSS.
          pleineLargeur && 'h-5 w-full',
        )}
      >
        {/* Le prévisionnel porte sa teinte et son tireté : deux teintes
            opaques ne se distingueraient pas en vision monochrome. Le tireté
            n'apparaît qu'à segment non vide — sinon un liseré annoncerait un
            prévisionnel qui n'existe pas. Le nom des deux segments est porté
            par la légende visible de la grille, une fois pour toutes les
            lignes — pas par ces `title`, qui n'existent qu'à la souris. */}
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
            className={cn(SEGMENT_PREVU, e.prevuCentiemes > 0 && SEGMENT_PREVU_BORDURE)}
            style={{ width: `${pct(e.prevuCentiemes)}%` }}
          />
        </div>

        {/* La frontière entre le réalisé et le prévisionnel : c'est là qu'on
            en est, et elle ne se lit pas sans repère. Elle ne sert que sur la
            réglette — sur une piste de deux points de haut, elle couvrirait la
            moitié de ce qu'elle désigne.

            Le trait est en `surface`, et non en encre : il se pose à la fois
            sur le réalisé, sur le prévisionnel et sur le vide, et aucune encre
            ne les contraste tous les trois dans les deux thèmes — en sombre,
            `inkDeep` et `offStrong` sont le même noir à un point de L\* près.

            Ce repère est **décoratif et redondant**, et il faut le dire
            franchement : rien ne le tient à un rapport de contraste. Une
            version antérieure de ce commentaire invoquait `MIN_LIGHTNESS_GAP`
            — 4 unités de L\*, ce qui n'est pas un rapport, et qui ne porte que
            sur `surface`/`off`/`offStrong`, jamais sur `accent` ni sur `prevu`.
            Mesuré : 1,36 à 1,45:1 sur la piste vide, 1,83:1 sur l'ambre de
            trois préréglages. Il n'est donc jamais le seul porteur de la
            frontière qu'il désigne — les quatre chiffres sont écrits juste
            dessous, en toutes lettres, et un test l'exige. */}
        {pleineLargeur && (
          <span
            aria-hidden="true"
            data-testid="trait-aujourdhui"
            className="absolute inset-y-0 w-0.5 bg-surface"
            style={{ left: `${pct(e.realiseCentiemes)}%` }}
          />
        )}
      </div>
      <span className="text-muted tabular-nums">
        {e.venduCentiemes / 100} vendus · {e.realiseCentiemes / 100} réalisés ·{' '}
        {e.prevuCentiemes / 100} prévus · {e.resteCentiemes / 100} restants
      </span>
      {e.depassementCentiemes > 0 && (
        <span className="text-warning-ink">dépassement de {e.depassementCentiemes / 100} j</span>
      )}
    </div>
  )
}
