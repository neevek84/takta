'use client'

import { useActionState, useEffect, useState } from 'react'
import { modifierLigne, type UpdateLineState } from './actions'
import { Button } from '@/components/ui/Button'

/**
 * Renommer une prestation, en ligne, sans toucher au reste.
 *
 * Séparé du formulaire des chiffres (`LigneForm`) à dessein : le libellé
 * reste local et modifiable même quand une prestation est reprise d'une
 * commande ou d'une propale Dolibarr, alors que les jours vendus et le TJM
 * peuvent, eux, être verrouillés. Le lien vers la tâche Dolibarr vit dans une
 * table à part (`ExternalLink`) — le renommer ici ne l'atteint jamais.
 */
export function RenamePrestation({ lineId, label }: { lineId: string; label: string }) {
  const [state, formAction, pending] = useActionState<UpdateLineState, FormData>(
    modifierLigne,
    null,
  )
  const [ouvert, setOuvert] = useState(false)

  useEffect(() => {
    if (state?.ok === true) setOuvert(false)
  }, [state])

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="group inline-flex items-center gap-1.5 rounded-sm text-left font-medium text-ink"
      >
        <span>{label}</span>
        <span
          aria-hidden="true"
          className="text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          ✎
        </span>
        <span className="sr-only">Renommer « {label} »</span>
      </button>
    )
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="lineId" value={lineId} />
      <input
        name="label"
        defaultValue={label}
        autoFocus
        required
        aria-label="Nouveau libellé de la prestation"
        className="touch-target w-48 rounded-md border border-rule bg-surface px-2 text-sm text-ink"
      />
      <Button type="submit" variant="quiet" loading={pending}>
        Enregistrer
      </Button>
      <Button type="button" variant="quiet" onClick={() => setOuvert(false)}>
        Annuler
      </Button>
      {state !== null && !state.ok && <span className="text-xs text-danger-ink">{state.message}</span>}
    </form>
  )
}
