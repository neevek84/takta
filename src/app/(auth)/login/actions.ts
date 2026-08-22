'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { creerPremierAdministrateur } from '@/services/auth/comptes'
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

/**
 * **Un refus, ou rien.** Le succès ne revient jamais par cet état : il quitte
 * l'écran. Porter un `ok: true` ici a produit exactement le défaut qu'on a
 * constaté — un bandeau vert de réussite affiché au-dessus du formulaire de
 * création, invitant à se connecter sur un écran qui ne le permettait pas.
 */
export type PremierAdminState = { message: string } | null

/**
 * Crée le premier administrateur d'une instance neuve.
 *
 * Le service refuse dès qu'un compte existe, et il le revérifie **dans** sa
 * transaction : cette action n'a donc pas à garder la porte elle-même.
 */
export async function creerPremierAdmin(
  _precedent: PremierAdminState,
  formData: FormData,
): Promise<PremierAdminState> {
  const r = await creerPremierAdministrateur({
    email: String(formData.get('email') ?? ''),
    name: String(formData.get('name') ?? ''),
    motDePasse: String(formData.get('motDePasse') ?? ''),
  })
  if (!r.ok) return { message: r.motif }

  // **Rendre un état ne suffisait pas, et c'est ce qui a été constaté sur
  // l'instance déployée.** Le composant client affichait « Compte créé »,
  // mais le composant *serveur* qui choisit entre « Premier démarrage » et
  // « Connexion » n'était jamais réévalué : le formulaire de création restait
  // au-dessus de son propre message de succès, lequel invitait à se connecter
  // sur un écran qui ne le permettait pas. Il fallait revenir à la main sur
  // l'adresse du site.
  //
  // `revalidatePath` purge le cache de route, qui porte encore « aucun
  // compte » ; la redirection redemande la page. Les deux sont nécessaires :
  // rediriger seul rendrait la version en cache.
  revalidatePath('/login')
  redirect('/login?cree=1')
}


/**
 * La seconde porte.
 *
 * `signIn('google')` redirige, et la redirection de Next passe par une
 * exception qu'il ne faut surtout pas avaler : aucun `try/catch` ici. Un
 * refus, lui, ne remonte pas jusqu'ici — la règle de liaison rend `null` et
 * Auth.js ramène sur l'écran de connexion.
 */
export async function connexionGoogle(): Promise<void> {
  await signIn('google', { redirectTo: '/saisie' })
}
