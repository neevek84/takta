import { AUDIT_ACTIONS } from '@/core/audit/events'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Field } from '@/components/ui/Field'
import { creerAbonnement } from './actions'

/**
 * Le formulaire n'affiche aucun secret : il en existe un, il sert à signer,
 * il ne se relit pas. Un secret qu'on affiche est un secret qu'on recopie
 * dans un ticket.
 */
export function WebhookForm() {
  return (
    <form action={creerAbonnement} className="flex flex-col gap-4">
      <Field label="Libellé" name="label" required />

      <Field
        label="URL à appeler"
        name="url"
        type="url"
        required
        placeholder="https://n8n.exemple.fr/webhook/cra"
      />

      <fieldset className="rounded-md border border-rule p-3">
        <legend className="px-1 text-sm font-medium">Événements souscrits</legend>
        <p className="mb-2 text-xs text-muted">
          Aucun coché = tous les événements.
        </p>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {AUDIT_ACTIONS.map((action) => (
            <Checkbox key={action} name="events" value={action} label={action} className="text-xs" />
          ))}
        </div>
      </fieldset>

      <div>
        <Button type="submit" variant="primary">Créer l’abonnement</Button>
      </div>
    </form>
  )
}
