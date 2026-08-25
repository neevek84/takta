'use client'

import { useActionState } from 'react'
import { modifierLigne, type UpdateLineState } from './actions'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { GestionPrestation } from './GestionPrestation'
import { engagementVerrouille, libelleEngagement } from '@/core/dolibarr/engagement'
import type { DisplayUnit, EngagementSource } from '@/core/types'

/**
 * Les chiffres d'une prestation existante — jours vendus, TJM, unité.
 *
 * Le libellé se renomme depuis la ligne du tableau (`RenamePrestation`), pas
 * ici : un renommage est un geste libre et fréquent, ces trois champs-là ne
 * le sont pas toujours — Dolibarr peut en rester maître. Les mélanger dans un
 * seul formulaire aurait caché cette différence.
 *
 * Composant client, et pas un `<form action={…}>` de page serveur : le
 * service peut refuser (engagement repris d'une propale, prestation non
 * affectée), et ce refus doit s'afficher plutôt que de laisser l'écran se
 * recomposer à l'identique.
 *
 * Quand l'engagement vient d'une propale Dolibarr, les deux chiffres vendus
 * sont affichés **en lecture seule et hors soumission** : le champ reste
 * visible et lisible — la valeur contractuelle est une information utile —
 * mais il ne porte pas de `name`, donc rien ne part.
 */
export function LigneForm({
  line,
  onClose,
}: {
  line: {
    id: string
    label: string
    soldCentiemes: number
    tjmCents: number
    displayUnit: DisplayUnit
    engagementSource: EngagementSource
  }
  /** Ferme le panneau — la visibilité est décidée par la ligne du tableau. */
  onClose: () => void
}) {
  const [state, formAction, pending] = useActionState<UpdateLineState, FormData>(
    modifierLigne,
    null,
  )

  const reprise = engagementVerrouille(line.engagementSource)

  return (
    <div className="flex flex-col gap-2">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="lineId" value={line.id} />

        <Field
          label="Jours vendus"
          {...(reprise ? {} : { name: 'joursVendus' })}
          type="number"
          step="0.5"
          min="0"
          readOnly={reprise}
          defaultValue={line.soldCentiemes / 100}
          className="w-28"
        />
        <Field
          label="TJM (€)"
          {...(reprise ? {} : { name: 'tjmEuros' })}
          type="number"
          step="1"
          min="0"
          readOnly={reprise}
          defaultValue={line.tjmCents / 100}
          className="w-28"
        />
        <Select label="Unité d’affichage" name="displayUnit" defaultValue={line.displayUnit}>
          <option value="JOUR">Jour</option>
          <option value="DEMI_JOUR">Demi-journée</option>
          <option value="HEURE">Heure</option>
        </Select>
        {/* `loading` et non `disabled` : l'attente se lit dans le texte du
            bouton, pas seulement dans une teinte atténuée. */}
        <Button type="submit" variant="primary" loading={pending}>
          Enregistrer
        </Button>
        <Button type="button" onClick={onClose}>
          Fermer
        </Button>
      </form>

      {reprise && (
        <p className="text-xs text-muted">
          Jours vendus et TJM repris de la {libelleEngagement(line.engagementSource)} : ils se
          modifient dans Dolibarr, qui en reste maître. L’application ne modifie jamais un document
          commercial.
        </p>
      )}

      {state !== null && !state.ok && (
        <Banner tone="danger" title="Prestation non enregistrée">
          {state.message}
        </Banner>
      )}
      {state?.ok === true && <Banner tone="success">Prestation enregistrée.</Banner>}

      <GestionPrestation lineId={line.id} label={line.label} />
    </div>
  )
}
