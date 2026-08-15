'use server'

import { redirect } from 'next/navigation'
// Import ciblé sur `@auth/core/errors` plutôt que sur `next-auth` : ce
// dernier réexporte la même classe mais son point d'entrée charge aussi la
// configuration `NextAuth()` complète (dont `next/server`), que Vitest ne
// sait pas résoudre hors du bundler Next. `@/auth`, lui, reste inchangé.
import { CredentialsSignin } from '@auth/core/errors'
import { signIn } from '@/auth'

/**
 * `signIn('credentials', { redirectTo })` lève dans les deux cas : un refus
 * (`CredentialsSignin`) et un succès, où la redirection elle-même est portée
 * par une exception interne à Next (`NEXT_REDIRECT`) qu'il ne faut surtout
 * pas avaler — un `catch` qui l'attraperait casserait la connexion réussie.
 * On ne distingue donc pas la redirection par son type ; on ne reconnaît que
 * ce qui nous appartient (`CredentialsSignin`) et on relance tout le reste
 * intact, succès compris.
 */
export async function login(formData: FormData): Promise<void> {
  const email = String(formData.get('email'))
  const password = String(formData.get('password'))

  try {
    await signIn('credentials', { email, password, redirectTo: '/saisie' })
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      // Un seul message, qu'il s'agisse d'un compte inconnu ou d'un mot de
      // passe erroné : `authorize()` renvoie `null` dans les deux cas. Les
      // distinguer ici permettrait d'énumérer les comptes existants.
      // `redirect()` lève elle-même en production (c'est ainsi qu'elle
      // navigue) ; le `return` explicite garde un comportement correct même
      // si elle ne le faisait pas — le `throw error` qui suit ne doit
      // s'exécuter que pour tout ce qui n'est pas un refus d'identifiants.
      redirect(`/login?erreur=1&email=${encodeURIComponent(email)}`)
      return
    }
    throw error
  }
}
