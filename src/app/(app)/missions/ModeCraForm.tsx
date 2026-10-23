'use client'

import { startTransition, useActionState, useState } from 'react'
import { saveModeCra, type ModeCraState } from './actions'
import { LIBELLES_MODE_CRA, MODES_CRA, type ModeCra } from '@/core/cra/perimetre'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'

/**
 * Ce que couvre un CRA de cette mission : toute la mission, ou chacune de ses
 * prestations.
 *
 * Le second sert un projet renouvelé par commandes successives : chaque
 * commande est une prestation du même projet, et se facture à part. Ce que le
 * changement fait aux CRA existants se dit ici — sinon on le découvrirait au
 * premier refus de génération.
 */
export function ModeCraForm({ missionId, modeCra }: { missionId: string; modeCra: ModeCra }) {
  const [state, formAction, pending] = useActionState<ModeCraState, FormData>(saveModeCra, null)
  // Contrôlée, et soumise par `onSubmit` plutôt que par `action` : React
  // réinitialise un formulaire passé par `action` une fois celle-ci terminée,
  // et la liste revenait sur l'ancien réglage sous un « Facturation
  // enregistrée ». Ce qu'on vient d'enregistrer doit rester affiché.
  const [choix, setChoix] = useState<ModeCra>(modeCra)

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault()
        const donnees = new FormData(ev.currentTarget)
        startTransition(() => formAction(donnees))
      }}
      className="mt-4 flex flex-col gap-2"
    >
      <input type="hidden" name="missionId" value={missionId} />
      <p className="text-sm text-muted">
        Par prestation, « Générer le CRA » ne couvre que la prestation choisie dans la saisie : son
        propre envoi, sa validation, sa facture et ses temps poussés vers Dolibarr. Les CRA déjà
        envoyés ou validés restent tels quels ; un brouillon jamais envoyé est remplacé à la
        prochaine génération.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="CRA"
          name="modeCra"
          value={choix}
          onChange={(ev) => setChoix(ev.target.value as ModeCra)}
          className="w-64"
        >
          {MODES_CRA.map((m) => (
            <option key={m} value={m}>
              {LIBELLES_MODE_CRA[m]}
            </option>
          ))}
        </Select>
        <Button type="submit" loading={pending}>
          Enregistrer la facturation
        </Button>
      </div>

      {state !== null && !state.ok && (
        <Banner tone="danger" title="Facturation non enregistrée">
          {state.erreur}
        </Banner>
      )}
      {state?.ok === true && <Banner tone="success">Facturation enregistrée.</Banner>}
    </form>
  )
}
