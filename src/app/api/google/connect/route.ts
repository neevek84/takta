import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { requireUser } from '@/auth'
import { buildConsentUrl } from '@/integrations/google/oauth'

export async function GET(request: Request): Promise<Response> {
  await requireUser()

  // Le connecteur est optionnel : une installation sans identifiants Google
  // est un état légitime, pas une panne. Sans ce garde-fou, le visiteur
  // atterrirait sur la page d'erreur de Google, chez Google, sans rien
  // comprendre ni pouvoir revenir.
  const configure =
    (process.env.GOOGLE_CLIENT_ID ?? '') !== '' && (process.env.GOOGLE_REDIRECT_URI ?? '') !== ''
  if (!configure) {
    const url = new URL('/admin/sync', request.url)
    url.searchParams.set('message', "La connexion Google n'est pas configurée sur ce serveur.")
    return Response.redirect(url.toString(), 302)
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

  return Response.redirect(buildConsentUrl({ state }), 302)
}
