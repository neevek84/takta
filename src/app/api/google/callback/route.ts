import { cookies } from 'next/headers'
import { requireUser } from '@/auth'
import { connectGoogle } from '@/services/google/connect'

/**
 * La destination du retour est écrite ici, jamais lue dans la requête : un
 * paramètre qui choisirait l'adresse de redirection ferait de ce point
 * d'entrée un tremplin vers n'importe quel site, sous notre nom de domaine.
 */
function retour(request: Request, message: string): Response {
  const url = new URL('/admin/sync', request.url)
  url.searchParams.set('message', message)
  return Response.redirect(url.toString(), 302)
}

export async function GET(request: Request): Promise<Response> {
  const user = await requireUser()
  const params = new URL(request.url).searchParams

  const jar = await cookies()
  const attendu = jar.get('google_oauth_state')?.value ?? ''
  // L'état ne sert qu'une fois : le laisser en place rendrait rejouable un
  // retour de consentement intercepté.
  jar.delete('google_oauth_state')

  if (params.get('error') !== null) {
    return retour(request, 'Connexion Google annulée.')
  }
  if (attendu === '' || params.get('state') !== attendu) {
    return retour(request, 'Connexion Google refusée : la demande ne vient pas de cet écran.')
  }

  const code = params.get('code') ?? ''
  if (code === '') return retour(request, 'Connexion Google incomplète : aucun code reçu.')

  try {
    await connectGoogle({ userId: user.id, code })
  } catch {
    return retour(request, 'La connexion Google a échoué. Réessayez.')
  }

  return retour(request, 'Google Calendar est connecté.')
}
