'use client'

import { useActionState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { testerCourriel, type TestCourrielState } from './actions'

/**
 * « Envoyer un courriel de test » : un vrai envoi, par le transport en vigueur
 * — celui des rappels et des codes de signature. Le verdict s'écrit en
 * toutes lettres ; la teinte du bandeau ne fait que le résumer.
 */
export function TestEnvoi({ adresseParDefaut }: { adresseParDefaut: string }) {
  const [state, formAction, enCours] = useActionState<TestCourrielState, FormData>(
    testerCourriel,
    null,
  )

  return (
    <Card title="Envoyer un courriel de test" className="mt-6">
      <p className="mb-3 text-sm text-muted">
        Envoie réellement un court message avec les réglages enregistrés. Enregistrez d’abord
        toute modification.
      </p>
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <Field
          label="Destinataire du test"
          name="destinataire"
          type="email"
          defaultValue={adresseParDefaut}
          autoComplete="email"
          className="w-80 max-w-full"
        />
        <Button type="submit" variant="primary" loading={enCours}>
          Envoyer un courriel de test
        </Button>
      </form>

      {state !== null && (
        <div className="mt-3">
          <Banner tone={state.ok ? 'success' : 'danger'}>
            <p>
              <strong>{state.ok ? 'Réussi' : 'Échec'}</strong> : {state.message}
            </p>
          </Banner>
        </div>
      )}
    </Card>
  )
}
