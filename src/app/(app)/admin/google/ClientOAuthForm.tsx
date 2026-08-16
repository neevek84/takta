'use client'

import { useActionState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { enregistrerClientGoogle, oublierClientGoogle, type ClientGoogleState } from './actions'

/**
 * Le formulaire du client OAuth Google.
 *
 * Il ne reçoit **aucun secret** : le secret du client se saisit, il ne se relit
 * jamais. C'est structurel — `getGoogleOAuthClientView` n'en porte pas, et le
 * champ repart vide à chaque rendu, y compris après un enregistrement réussi.
 */
export function ClientOAuthForm({
  clientId,
  redirectUri,
  urlRetourProposee,
  configure,
  configuredAt,
}: {
  clientId: string
  redirectUri: string
  /** Calculée depuis l'adresse par laquelle cet écran est réellement atteint. */
  urlRetourProposee: string
  configure: boolean
  configuredAt: Date | null
}) {
  const [state, formAction, enCours] = useActionState<ClientGoogleState, FormData>(
    enregistrerClientGoogle,
    null,
  )

  return (
    <Card title="Client OAuth Google">
      <p className="mb-3 text-sm text-muted">
        {configure
          ? 'Un client OAuth est enregistré. Le secret est chiffré au repos et n’est jamais réaffiché.'
          : 'Aucun client OAuth n’est enregistré. La saisie des CRA, les missions et les PDF fonctionnent intégralement sans Google.'}
      </p>
      {configure && configuredAt !== null && (
        <p className="mb-3 text-sm text-muted">
          Enregistré le{' '}
          <time dateTime={configuredAt.toISOString()}>{configuredAt.toISOString().slice(0, 10)}</time>
          .
        </p>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <Field
          label="Identifiant du client (client ID)"
          name="clientId"
          defaultValue={clientId}
          autoComplete="off"
          placeholder="1234567890-abc.apps.googleusercontent.com"
          className="w-96"
        />
        <Field
          label="Secret du client (client secret)"
          name="clientSecret"
          type="password"
          autoComplete="off"
          // Aucune `defaultValue` : la saisie repart vide, toujours.
          hint="Saisi ici, jamais dans un fichier."
          className="w-64"
        />
        <Field
          label="URL de retour (redirect URI)"
          name="redirectUri"
          // La valeur enregistrée d'abord ; à défaut, celle qui correspond à
          // l'adresse réellement servie. Personne n'a à la deviner.
          defaultValue={redirectUri === '' ? urlRetourProposee : redirectUri}
          inputMode="url"
          hint="Elle doit correspondre au caractère près à celle enregistrée chez Google."
          className="w-96"
        />
        <Button type="submit" variant="primary" loading={enCours}>
          {enCours ? 'Enregistrement' : 'Enregistrer'}
        </Button>
      </form>

      {state !== null && state.ok && (
        <div className="mt-3">
          <Banner tone="success">{state.message}</Banner>
        </div>
      )}
      {state !== null && !state.ok && (
        <div className="mt-3">
          <Banner tone="danger" title="Le client OAuth n'a pas été enregistré">
            <ul className="list-disc pl-5">
              {state.erreurs.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {configure && (
        <form action={oublierClientGoogle} className="mt-3">
          <Button type="submit" variant="danger">
            Oublier ce client
          </Button>
        </form>
      )}
    </Card>
  )
}
