'use client'

import { saisiesParJour } from '@/core/month/build'
import { centiemesParFacteur, formatJours } from '@/core/time/units'
import { depasseCapacite } from '@/core/capacity/check'
import type { MonthDay } from '@/core/month/build'
import type { MinutesAuFacteur } from '@/core/time/units'
import type { MonthEntry } from '@/services/time-entries'

const AUCUNE_SAISIE: MinutesAuFacteur[] = []

/**
 * Ligne de totaux de la grille.
 *
 * Le chiffre affiché et le marqueur de dépassement sortent du **même calcul
 * que le service** : chaque saisie est convertie sous le facteur figé à son
 * écriture (`centiemesParFacteur`), et le dépassement est jugé par
 * `depasseCapacite`, celui-là même qu'emploie `checkCapacity`. Sommer les
 * minutes brutes de la journée puis les convertir au facteur global — ce que
 * faisait cette ligne — affichait sur le même écran un total et un « ! » que
 * le service pouvait contredire sur la même journée.
 */
export function TotalsRow({
  days,
  entries,
  capacityCentiemes,
}: {
  days: MonthDay[]
  entries: MonthEntry[]
  /** capacité d'une journée, telle qu'elle est réglée : jamais convertie */
  capacityCentiemes: number
}) {
  const parJour = saisiesParJour(entries)

  return (
    <tr className="border-t-2 border-rule font-medium">
      <th scope="row" className="sticky left-0 bg-surface px-2 py-1 text-left text-sm">
        Total
      </th>
      {days.map((d) => {
        const saisies = parJour.get(d.date) ?? AUCUNE_SAISIE
        const over = capacityCentiemes > 0 && depasseCapacite(saisies, capacityCentiemes)
        return (
          // Le dépassement porte trois signaux — teinte, graisse soulignée et
          // glyphe — dont deux survivent à une vision monochrome.
          <td
            key={d.date}
            data-testid={`total-${d.date}`}
            data-depassement={over ? 'true' : 'false'}
            title={over ? 'Capacité dépassée' : undefined}
            className={`px-1 py-1 text-center text-xs ${
              over ? 'font-bold text-danger-ink underline decoration-2' : 'text-muted'
            }`}
          >
            {over && <span aria-hidden="true">! </span>}
            {formatJours(centiemesParFacteur(saisies))}
          </td>
        )
      })}
    </tr>
  )
}
