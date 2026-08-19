'use client'

import { useActionState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { connecterDolibarr, deconnecterDolibarr, type ConnexionState } from './actions'

/**
 * Le formulaire de connexion à Dolibarr.
 *
 * Il ne reçoit **aucun secret** : la clé se saisit, elle ne se relit jamais.
 * C'est structurel, pas une politesse — la vue rendue par
 * `getInstanceCredential` n'en porte pas, et le champ repart vide à chaque
 * rendu.
 */
export function ConnexionForm({
  instanceUrl,
  dolibarrUserId,
  connecte,
  connectedAt,
}: {
  /** l'adresse de l'instance, sans le chemin de l'API : ce qui se saisit se réaffiche */
  instanceUrl: string
  dolibarrUserId: string
  connecte: boolean
  connectedAt: Date | null
}) {
  const [state, formAction, enCours] = useActionState<ConnexionState, FormData>(
    connecterDolibarr,
    null,
  )

  return (
    <Card title="Connexion">
      <p className="mb-3 text-sm text-muted">
        {connecte
          ? "Dolibarr est connecté. La clé d'API est chiffrée au repos et n'est jamais réaffichée."
          : "Dolibarr n'est pas connecté. Tout reste créable et modifiable sans lui."}
      </p>
      {connecte && connectedAt !== null && (
        <p className="mb-3 text-sm text-muted">
          Clé enregistrée le{' '}
          <time dateTime={connectedAt.toISOString()}>
            {connectedAt.toISOString().slice(0, 10)}
          </time>
          .
        </p>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <Field
          label="URL de l'instance Dolibarr"
          name="instanceUrl"
          defaultValue={instanceUrl}
          placeholder="https://erp.exemple.invalid"
          inputMode="url"
          hint="Celle de votre navigateur. Le chemin de l'API est ajouté tout seul."
          className="w-80"
        />
        <Field
          label="Clé d'API"
          name="apiKey"
          type="password"
          autoComplete="off"
          // Aucune `defaultValue` : la saisie repart vide, toujours.
          hint="Saisie ici, jamais dans un fichier d'environnement."
          className="w-64"
        />
        <Field
          label="Identifiant utilisateur Dolibarr"
          name="dolibarrUserId"
          defaultValue={dolibarrUserId}
          inputMode="numeric"
          hint="Un temps passé en exige un."
          className="w-56"
        />
        <Button type="submit" variant="primary" loading={enCours}>
          {enCours ? 'Vérification' : 'Connecter'}
        </Button>
      </form>

      {state !== null && state.ok && (
        <div className="mt-3">
          <Banner tone="success">{state.message}</Banner>
        </div>
      )}
      {state !== null && !state.ok && (
        <div className="mt-3">
          <Banner tone="danger" title="La connexion n'a pas été enregistrée">
            <ul className="list-disc pl-5">
              {state.erreurs.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {connecte && (
        <form action={deconnecterDolibarr} className="mt-3">
          <Button type="submit" variant="danger">
            Déconnecter
          </Button>
        </form>
      )}
    </Card>
  )
}
