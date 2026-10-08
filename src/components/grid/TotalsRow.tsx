'use client'

import { Fragment } from 'react'
import { grouperParMois, saisiesParJour } from '@/core/month/build'
import { centiemesParFacteur, formatJours } from '@/core/time/units'
import { checkCapacity } from '@/core/capacity/check'
import type { MonthDay } from '@/core/month/build'
import type { MinutesAuFacteur } from '@/core/time/units'
import type { CapacityMode } from '@/core/types'
import type { MonthEntry } from '@/services/time-entries'

const AUCUNE_SAISIE: MinutesAuFacteur[] = []

/**
 * Ligne de totaux de la grille.
 *
 * Le chiffre affiché et le marqueur de dépassement sortent du **même calcul
 * que le service** : chaque saisie est convertie sous le facteur figé à son
 * écriture (`centiemesParFacteur`), et le dépassement est jugé par
 * `checkCapacity` lui-même — la fonction qu'appellent `applyCellState` et
 * `saveEntry`, mode compris. Sommer les minutes brutes de la journée puis les
 * convertir au facteur global — ce que faisait cette ligne — affichait sur le
 * même écran un total et un « ! » que le service pouvait contredire sur la
 * même journée ; juger sans le mode faisait de même en `DESACTIVE`, où le
 * service ne dit délibérément rien.
 */
export function TotalsRow({
  days,
  entries,
  capacityCentiemes,
  capacityMode,
  parMois = false,
}: {
  days: MonthDay[]
  entries: MonthEntry[]
  /** capacité d'une journée, telle qu'elle est réglée : jamais convertie */
  capacityCentiemes: number
  /** mode réglé : c'est lui qui décide si un dépassement se dit */
  capacityMode: CapacityMode
  /**
   * vrai sur le tableau 3 mois : une colonne de total suit chaque mois, et le
   * premier jour de chacun porte la frontière — la ligne reste alignée sur les
   * colonnes que la grille pose au-dessus d'elle.
   */
  parMois?: boolean
}) {
  const parJour = saisiesParJour(entries)

  return (
    <tr className="border-t-2 border-rule font-medium">
      <th scope="row" className="sticky left-0 bg-surface px-2 py-1 text-left text-sm">
        Total
      </th>
      {grouperParMois(days).map((bloc) => (
        <Fragment key={bloc.mois}>
          {bloc.days.map((d, i) => {
            const saisies = parJour.get(d.date) ?? AUCUNE_SAISIE
            // Capacité à zéro : aucun seuil n'est réglé, il n'y a rien à dépasser.
            const over =
              capacityCentiemes > 0 &&
              !checkCapacity({ existing: saisies, added: [], capacityCentiemes, mode: capacityMode }).ok
            return (
              // Le dépassement porte trois signaux — teinte, graisse soulignée et
              // glyphe — dont deux survivent à une vision monochrome.
              <td
                key={d.date}
                data-testid={`total-${d.date}`}
                data-depassement={over ? 'true' : 'false'}
                title={over ? 'Capacité dépassée' : undefined}
                className={`px-1 py-1 text-center text-xs ${
                  parMois && i === 0 ? 'border-l-2 border-l-ink' : ''
                } ${over ? 'font-bold text-danger-ink underline decoration-2' : 'text-muted'}`}
              >
                {over && <span aria-hidden="true">! </span>}
                {formatJours(centiemesParFacteur(saisies))}
              </td>
            )
          })}
          {/* Le total du mois, converti saisie par saisie sous son facteur
              figé — le même calcul que chaque colonne de jour. */}
          {parMois && (
            <td
              data-testid={`total-mois-${bloc.mois}`}
              className="border-l border-rule px-1 py-1 text-center text-xs text-ink"
            >
              {formatJours(
                centiemesParFacteur(bloc.days.flatMap((d) => parJour.get(d.date) ?? AUCUNE_SAISIE)),
              )}
            </td>
          )}
        </Fragment>
      ))}
    </tr>
  )
}
