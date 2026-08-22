'use client'

import { useActionState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { creerPremierAdmin, type PremierAdminState } from './actions'

/**
 * Le seul écran du produit où un humain décide du rôle d'un compte — et c'est
 * un administrateur, parce que lui seul pourra ensuite configurer Dolibarr et
 * Google.
 *
 * Il ne s'affiche que sur une base **sans aucun utilisateur**. Cette condition
 * ne se reproduit jamais d'elle-même : vraie une fois, à l'installation, fausse
 * pour toujours ensuite. C'est ce qui permet de l'exposer sans ouvrir de porte
 * durable — mais l'installation doit être renseignée **tout de suite** après
 * son premier démarrage, car tant qu'elle est vide, quiconque connaît son
 * adresse peut prendre la place.
 */
export function PremierAdminForm() {
  const [etat, formAction, enCours] = useActionState<PremierAdminState, FormData>(
    creerPremierAdmin,
    null,
  )

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-3">
        {/* Toujours un refus : le succès ne revient pas ici, il redirige. */}
        {etat !== null && <Banner tone="danger">{etat.message}</Banner>}
        <p className="text-sm text-muted">
          Cette instance n’a encore aucun compte. Créez celui de l’administrateur : il pourra
          ensuite connecter Dolibarr et Google.
        </p>
        <Field label="Nom" name="name" required />
        <Field label="Adresse e-mail" name="email" type="email" required />
        <Field
          label="Mot de passe"
          name="motDePasse"
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
        />
        <p className="text-sm text-muted">
          Douze caractères au minimum. Cet écran répond dès que l’installation est joignable :
          c’est la seule porte, choisissez un vrai mot de passe.
        </p>
        <Button type="submit" variant="primary" disabled={enCours}>
          Créer le premier administrateur
        </Button>
      </form>
    </Card>
  )
}
