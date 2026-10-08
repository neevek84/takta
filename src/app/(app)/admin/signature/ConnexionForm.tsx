'use client'

import { useActionState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import type { Provenance } from '@/services/signature/reglages'
import {
  deconnecterSignature,
  enregistrerSignature,
  type ConnexionSignatureState,
} from './actions'

/** La provenance, en toutes lettres : c'est elle qui dit quoi corriger, et où. */
export const LIBELLE_PROVENANCE: Record<Provenance, string> = {
  ecran: 'saisie sur cet écran',
  env: "variables d'environnement",
  aucune: 'aucune',
}

/**
 * Le formulaire de l'instance Documenso.
 *
 * Il ne reçoit **aucun secret** : la clé se saisit, elle ne se relit jamais,
 * et le champ repart vide à chaque rendu. Laissé vide, il conserve la clé
 * enregistrée — corriger une URL n'oblige pas à ressaisir ce qu'on ne voit pas.
 */
export function ConnexionForm({
  baseUrl,
  provenance,
  enregistreLe,
}: {
  baseUrl: string
  provenance: Provenance
  enregistreLe: Date | null
}) {
  const [state, formAction, enCours] = useActionState<ConnexionSignatureState, FormData>(
    enregistrerSignature,
    null,
  )
  const cleEnregistree = provenance === 'ecran'

  return (
    <Card title="Instance Documenso">
      <p className="mb-3 text-sm text-ink">
        Configuration en vigueur : <strong>{LIBELLE_PROVENANCE[provenance]}</strong>.
      </p>
      <p className="mb-3 text-sm text-muted">
        {provenance === 'env'
          ? "Les variables DOCUMENSO_URL et DOCUMENSO_API_KEY servent de repli. Un réglage enregistré ici l'emporte sur elles."
          : provenance === 'aucune'
            ? 'Sans instance, le PDF se génère et se télécharge, et les transitions du CRA restent manuelles.'
            : "La clé d'API est chiffrée au repos et n'est jamais réaffichée."}
      </p>
      {cleEnregistree && enregistreLe !== null && (
        <p className="mb-3 text-sm text-muted">
          Enregistrée le{' '}
          <time dateTime={enregistreLe.toISOString()}>{enregistreLe.toISOString().slice(0, 10)}</time>.
        </p>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <Field
          label="URL de l'instance Documenso"
          name="baseUrl"
          // Une URL venue de l'environnement ne se préremplit pas : l'enregistrer
          // telle quelle la ferait passer à l'écran sans qu'on l'ait voulu.
          defaultValue={cleEnregistree ? baseUrl : ''}
          placeholder="https://sign.exemple.invalid"
          inputMode="url"
          hint="Documenso 2.0 ou plus."
          className="w-80"
        />
        <Field
          label="Clé d'API"
          name="apiKey"
          type="password"
          autoComplete="off"
          // Aucune `defaultValue` : la saisie repart vide, toujours.
          hint={cleEnregistree ? 'Une clé est enregistrée : laisser vide pour conserver.' : undefined}
          className="w-64"
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
          <Banner tone="danger" title="Le réglage n'a pas été enregistré">
            <ul className="list-disc pl-5">
              {state.erreurs.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {cleEnregistree && (
        <form action={deconnecterSignature} className="mt-3">
          <Button type="submit" variant="danger">
            Déconnecter
          </Button>
        </form>
      )}
    </Card>
  )
}
