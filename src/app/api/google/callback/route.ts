import { cookies } from 'next/headers'
import { requireUser } from '@/auth'
import { SecretBoxError } from '@/core/crypto/secret-box'
import { connectGoogle, GoogleClientAbsentError } from '@/services/google/connect'
import { journalErreur } from '@/services/log'
import { originePublique } from '@/core/http/origine'

/**
 * Une `SecretBoxError` sur ce chemin ne peut venir que de `CREDENTIALS_KEY` :
 * l'enregistrement des jetons ne fait que chiffrer, jamais déchiffrer. C'est
 * un défaut de configuration du serveur, pas un aléa — et il faut le dire,
 * parce que « Réessayez » envoie recommencer une opération qui ne peut jamais
 * aboutir. Le message la nomme (promesse du README) : c'est un nom de
 * variable, jamais sa valeur.
 */
const MESSAGE_CLE_ABSENTE =
  'Connexion Google impossible : ce serveur n’a pas de CREDENTIALS_KEY valide. ' +
  'Recommencer ne changera rien — voir les journaux du serveur.'

/**
 * La destination du retour est écrite ici, jamais lue dans la requête : un
 * paramètre qui choisirait l'adresse de redirection ferait de ce point
 * d'entrée un tremplin vers n'importe quel site, sous notre nom de domaine.
 *
 * La **tonalité** voyage avec le message, et ce n'est pas décoratif : cet
 * écran affichait tout retour à l'identique, refus compris, si bien qu'une
 * connexion refusée avait exactement l'air d'une connexion réussie.
 */
function retour(request: Request, message: string, tone: 'success' | 'danger' = 'danger'): Response {
  // **L'origine vient des en-têtes, pas de `request.url`.** Derrière un proxy,
  // l'URL vue par le conteneur porte une adresse interne : le visiteur était
  // renvoyé vers un hôte qu'il ne peut pas atteindre, au retour d'un
  // consentement qui avait pourtant abouti.
  const origine = originePublique(process.env.AUTH_URL, (nom) => request.headers.get(nom))
  const url = new URL('/profil', origine !== '' ? origine : request.url)
  url.searchParams.set('message', message)
  url.searchParams.set('tone', tone)
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
  } catch (err) {
    // La cause reste hors de l'écran — elle nomme Google, des URL, parfois un
    // code HTTP — mais elle ne doit plus disparaître : sans cette ligne, une
    // connexion qui ne peut pas aboutir est indiscernable d'un aléa réseau.
    journalErreur('google.callback', err, { userId: user.id })
    if (err instanceof SecretBoxError) return retour(request, MESSAGE_CLE_ABSENTE)
    // Le client OAuth a disparu entre le départ et le retour : recommencer ne
    // servira à rien tant qu'il n'est pas ressaisi, et l'écran doit le dire.
    if (err instanceof GoogleClientAbsentError) return retour(request, err.message)
    return retour(request, 'La connexion Google a échoué. Réessayez.')
  }

  return retour(request, 'Google Calendar est connecté.', 'success')
}
