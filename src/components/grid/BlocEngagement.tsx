'use client'

import { OCCUPATION_TITRE } from '@/core/saisie/occupation'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals } from '@/services/time-entries'
import { SegmentLegend } from '@/components/ui/SegmentLegend'
import { EngagementBar } from './EngagementBar'

const AUCUN_TOTAL: LineEngagementTotals = []

type EtatJour = 'ouvre' | 'weekend' | 'ferie'

// Fond ET motif — mais le motif ne sert plus qu'au férié. Le dithering du
// week-end était le signal d'ancienneté le plus fort du dessin, et il couvrait
// huit jours par mois. Le contrat non chromatique tient sans lui : l'écart de
// clarté entre `surface`, `off` et `off-strong` (100 / 91,2 / 85,4 en L*)
// porte l'information, et `MIN_LIGHTNESS_GAP` le vérifie déjà — le nom
// accessible du jour la porte pour qui ne voit ni l'un ni l'autre.
//
// Le férié garde le sien : dix jours par an, une information plus forte, et un
// marqueur si rare ne fatigue personne.
export const FOND_JOUR: Record<EtatJour, string> = {
  ouvre: 'bg-surface',
  weekend: 'bg-off',
  ferie: 'bg-off-strong pattern-dots',
}

export const TITRE_JOUR: Record<EtatJour, string | undefined> = {
  ouvre: undefined,
  weekend: 'Jour non ouvré',
  ferie: 'Jour férié',
}


/**
 * Le bloc d'information posé au-dessus d'une grille : légende des segments,
 * légende des jours, puis une barre d'engagement nommée par prestation.
 * Partagé par les tableaux et la vue 3 mois — le recopier ferait dériver deux
 * légendes censées dire la même chose.
 *
 * `avecOccupation` n'ajoute l'item d'occupation que s'il y a quelque chose à
 * nommer : une légende qui annonce un marquage absent égare plus qu'elle
 * n'aide, et l'agenda injoignable est un cas ordinaire.
 */
export function BlocEngagement({
  lines,
  engagementTotals,
  avecOccupation,
}: {
  lines: LineForGrid[]
  engagementTotals: Record<string, LineEngagementTotals>
  avecOccupation: boolean
}) {
  return (
    <div className="mb-3 flex flex-col gap-1">
      {/* Les bandeaux dessinent deux segments, et les colonnes trois états
          de jour ; sans légende, rien ne dit lequel est lequel ailleurs
          qu'au survol de la souris — donc jamais au clavier ni au tactile. */}
      <SegmentLegend className="mb-1" />
      <p
        data-testid="legende-jours"
        className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
      >
        {(['weekend', 'ferie'] as const).map((etat) => (
          <span key={etat} className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className={`inline-block h-3 w-4 rounded-sm border border-rule ${FOND_JOUR[etat]}`}
            />
            {TITRE_JOUR[etat]}
          </span>
        ))}
        {avecOccupation && (
          <span className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-4 rounded-sm border border-rule border-b-2 border-b-accent-dark bg-surface"
            />
            {OCCUPATION_TITRE}
          </span>
        )}
      </p>
      {lines.map((l) => (
        <EngagementBar
          key={l.id}
          line={l}
          totals={engagementTotals[l.id] ?? AUCUN_TOTAL}
          avecLibelle
        />
      ))}
    </div>
  )
}
