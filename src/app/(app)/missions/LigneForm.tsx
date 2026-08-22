'use client'

import { useActionState, useState } from 'react'
import { modifierLigne, type UpdateLineState } from './actions'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { GestionPrestation } from './GestionPrestation'
import { engagementVerrouille, libelleEngagement } from '@/core/dolibarr/engagement'
import type { DisplayUnit, EngagementSource } from '@/core/types'

/**
 * Le formulaire d'une prestation existante.
 *
 * Composant client, et pas un `<form action={…}>` de page serveur : le service
 * peut refuser (engagement repris d'une propale, prestation non affectée), et
 * ce refus doit s'afficher plutôt que de laisser l'écran se recomposer à
 * l'identique.
 *
 * Quand l'engagement vient d'une propale Dolibarr, les deux chiffres vendus
 * sont affichés **en lecture seule et hors soumission** : le champ reste
 * visible et lisible — la valeur contractuelle est une information utile — mais
 * il ne porte pas de `name`, donc rien ne part. Un champ qu'on peut remplir
 * mais dont l'enregistrement sera refusé est pire que pas de champ du tout, et
 * le verrou reste de toute façon posé côté service : l'écran ne fait que ne pas
 * mentir.
 */
export function LigneForm({
  line,
}: {
  line: {
    id: string
    label: string
    soldCentiemes: number
    tjmCents: number
    displayUnit: DisplayUnit
    engagementSource: EngagementSource
  }
}) {
  const [state, formAction, pending] = useActionState<UpdateLineState, FormData>(
    modifierLigne,
    null,
  )

  // Sans `name`, le champ n'entre pas dans la soumission — c'est ce qui
  // distingue « affiché » de « envoyé ». La question posée n'est plus « est-ce
  // une propale ? » mais « Dolibarr en est-il maître ? » : la première laissait
  // un engagement repris d'une commande modifiable ici.
  const reprise = engagementVerrouille(line.engagementSource)

  // Replié par défaut : le volet de détail portait autant de formulaires
  // ouverts que la mission a de prestations, alors qu'on n'en modifie qu'une à
  // la fois — et rarement.
  const [ouvert, setOuvert] = useState(false)
  if (!ouvert) {
    return (
      <Button type="button" className="mt-2" onClick={() => setOuvert(true)}>
        Modifier « {line.label} »
      </Button>
    )
  }

  return (
    // Le rangement et la suppression vivent **hors** du formulaire : un
    // `<form>` ne s'imbrique pas, et son bouton « Enregistrer » ne doit pas
    // se déclencher en visant « Supprimer » — enregistrer en silence des
    // chiffres qu'on n'avait pas relus, juste avant de détruire, serait le
    // pire des enchaînements.
    <>
      <form action={formAction} className="mt-3 flex flex-col gap-2">
        <input type="hidden" name="lineId" value={line.id} />

        <div className="flex flex-wrap items-end gap-2">
          <Field label="Libellé" name="label" defaultValue={line.label} />
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
          <Button type="button" onClick={() => setOuvert(false)}>
            Fermer
          </Button>
        </div>

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
      </form>

      <GestionPrestation lineId={line.id} label={line.label} />
    </>
  )
}
