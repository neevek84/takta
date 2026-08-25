'use client'

import { useState } from 'react'
import { libelleEngagement } from '@/core/dolibarr/engagement'
import type { DisplayUnit, EngagementSource } from '@/core/types'
import { Button } from '@/components/ui/Button'
import { Origine } from '@/components/ui/Origine'
import { LigneForm } from './LigneForm'
import { RenamePrestation } from './RenamePrestation'

const LIBELLE_UNITE: Record<DisplayUnit, string> = {
  JOUR: 'Jour',
  DEMI_JOUR: 'Demi-journée',
  HEURE: 'Heure',
}

/**
 * Une prestation dans le tableau du détail de mission.
 *
 * Colonnes alignées plutôt que blocs en retour à la ligne : jours, tarifs et
 * unités se comparent d'un coup d'œil d'une prestation à l'autre. « Modifier »
 * ouvre une seconde ligne, pleine largeur, plutôt que de pousser les colonnes
 * — les chiffres qu'on modifie ne sont pas ceux qu'on vient de comparer.
 */
export function LigneRow({
  line,
}: {
  line: {
    id: string
    label: string
    soldCentiemes: number
    tjmCents: number
    displayUnit: DisplayUnit
    engagementSource: EngagementSource
    dolibarrTaskId: number | null
  }
}) {
  const [modifierOuvert, setModifierOuvert] = useState(false)

  return (
    <>
      <tr className="border-b border-off last:border-0">
        <td className="py-2.5 pr-3 align-top">
          <RenamePrestation lineId={line.id} label={line.label} />
          <span className="block text-xs text-muted">
            Engagement : {libelleEngagement(line.engagementSource)}
          </span>
        </td>
        <td className="py-2.5 pr-3 text-right align-top">{line.soldCentiemes / 100} j</td>
        <td className="py-2.5 pr-3 text-right align-top">{line.tjmCents / 100} €</td>
        <td className="py-2.5 pr-3 align-top text-muted">{LIBELLE_UNITE[line.displayUnit]}</td>
        <td className="py-2.5 pr-3 align-top">
          <Origine
            dansDolibarr={line.dolibarrTaskId !== null}
            detail={
              line.dolibarrTaskId === null
                ? 'aucune tâche Dolibarr : les temps de cette prestation ne partiront pas'
                : `tâche n° ${line.dolibarrTaskId}`
            }
          />
        </td>
        <td className="py-2.5 text-right align-top">
          <Button type="button" variant="quiet" onClick={() => setModifierOuvert((v) => !v)}>
            {modifierOuvert ? 'Fermer' : 'Modifier'}
          </Button>
        </td>
      </tr>
      {modifierOuvert && (
        <tr className="border-b border-off last:border-0">
          <td colSpan={6} className="bg-off px-3 py-3">
            <LigneForm line={line} onClose={() => setModifierOuvert(false)} />
          </td>
        </tr>
      )}
    </>
  )
}
