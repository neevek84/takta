'use client'

import { useActionState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { demanderLien, poserMotDePasse, type MotDePasseState } from './actions'

/**
 * Un seul écran pour deux moments : demander un lien, et poser le mot de passe
 * qu'il autorise. La présence du jeton dans l'URL décide lequel — champs et
 * action ensemble : les dissocier enverrait l'adresse au service qui attend un
 * jeton.
 *
 * Le vocabulaire dit **définir** autant que **réinitialiser** : ce parcours est
 * aussi celui d'un compte né sans mot de passe, qui n'a rien oublié.
 */
export function FormulaireMotDePasse({ jeton }: { jeton: string }) {
  const action = jeton === '' ? demanderLien : poserMotDePasse
  const [etat, formAction, enCours] = useActionState<MotDePasseState, FormData>(action, null)

  return (
    <Card>
      <form action={formAction} className="flex flex-col gap-3">
        {etat !== null && <Banner tone={etat.ok ? 'success' : 'danger'}>{etat.message}</Banner>}

        {jeton === '' ? (
          <>
            <p className="text-sm text-muted">
              Indiquez votre adresse : nous enverrons un lien pour définir ou réinitialiser votre
              mot de passe. Il est valable dix minutes.
            </p>
            <Field label="Adresse e-mail" name="email" type="email" required />
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Choisissez votre mot de passe — au moins 12 caractères.
            </p>
            {/* Caché, jamais réaffiché : à l'écran, le jeton partirait dans la
                première capture ou la première URL recopiée. */}
            <input type="hidden" name="jeton" value={jeton} />
            <Field
              label="Nouveau mot de passe"
              name="motDePasse"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
            />
          </>
        )}

        <Button type="submit" variant="primary" disabled={enCours}>
          {jeton === '' ? 'Envoyer le lien' : 'Enregistrer le mot de passe'}
        </Button>
      </form>
    </Card>
  )
}
