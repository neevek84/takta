import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { requireUser } from '@/auth'
import { buildConsentUrl } from '@/integrations/google/oauth'
import { readGoogleOAuthClient } from '@/services/google/oauth-client'
import { journalAvertissement } from '@/services/log'

export async function GET(request: Request): Promise<Response> {
  await requireUser()

  // Le connecteur est optionnel : une installation sans client OAuth Google
  // est un état légitime, pas une panne. Sans ce garde-fou, le visiteur
  // atterrirait sur la page d'erreur de Google, chez Google, sans rien
  // comprendre ni pouvoir revenir.
  //
  // Le client vient de la base, où il a été saisi à l'écran. Il ne vient plus
  // de l'environnement, et surtout il ne vient JAMAIS de la requête : une
  // `redirect_uri` lue dans un paramètre enverrait le code de consentement de
  // l'utilisateur à l'adresse choisie par qui a forgé le lien.
  const client = await readGoogleOAuthClient()
  if (client === null) {
    // L'écran dit quoi faire — l'écran d'administration existe, et c'est là
    // que ça se règle. Le journal ne porte que la raison : ni identifiant, ni
    // URL, ni a fortiori de secret.
    journalAvertissement('google.connect', { raison: 'client-oauth-absent' })
    return versAdmin(
      request,
      "Aucun client OAuth Google n'est enregistré : renseignez-le dans Administration · Google.",
    )
  }

  // État anti-rejeu : il repart avec la redirection et doit revenir identique.
  const state = randomBytes(16).toString('hex')
  const jar = await cookies()
  jar.set('google_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    secure: process.env.NODE_ENV === 'production',
  })

  return Response.redirect(buildConsentUrl({ client, state }), 302)
}

/** Retour vers l'écran qui porte la configuration, avec le motif du renvoi. */
function versAdmin(request: Request, message: string): Response {
  const url = new URL('/admin/google', request.url)
  url.searchParams.set('message', message)
  url.searchParams.set('tone', 'warning')
  return Response.redirect(url.toString(), 302)
}
