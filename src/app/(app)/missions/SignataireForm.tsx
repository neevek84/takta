'use client'

import { useActionState } from 'react'
import { saveSignataire, type SignataireState } from './actions'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'

/**
 * Le contact signataire d'une **mission**.
 *
 * Composant client, et pas un simple `<form action={…}>` de page serveur : le
 * service refuse une adresse invalide ou un nom sans adresse, et ce refus doit
 * s'afficher. Sans lui, l'écran se recomposerait à l'identique et l'utilisateur
 * repartirait convaincu d'avoir enregistré un destinataire qui n'existe pas.
 */
export function SignataireForm({
  missionId,
  signataireNom,
  signataireEmail,
}: {
  missionId: string
  signataireNom: string
  signataireEmail: string
}) {
  const [state, formAction, pending] = useActionState<SignataireState, FormData>(
    saveSignataire,
    null,
  )

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="missionId" value={missionId} />

      <div className="flex flex-wrap items-end gap-2">
        <Field
          label="Signataire du CRA"
          name="signataireNom"
          defaultValue={signataireNom}
          placeholder="Nom du contact"
        />
        <Field
          label="Adresse électronique"
          name="signataireEmail"
          type="email"
          defaultValue={signataireEmail}
          hint="Le destinataire du CRA à signer, propre à cette mission."
        />
        {/* `loading` et non `disabled` : l'attente se lit dans le texte du
            bouton, pas seulement dans une teinte atténuée. */}
        <Button type="submit" loading={pending}>
          Enregistrer le signataire
        </Button>
      </div>

      {state !== null && !state.ok && (
        <Banner tone="danger" title="Signataire non enregistré">
          {state.erreur}
        </Banner>
      )}
      {state?.ok === true && <Banner tone="success">Signataire enregistré.</Banner>}
    </form>
  )
}
