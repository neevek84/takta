import type { GoogleOAuthClient } from '@/core/google/oauth-client'
import type { FetchLike } from './calendar'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CONSENT_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const SCOPES = ['https://www.googleapis.com/auth/calendar'].join(' ')

export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleOAuthError'
  }
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

async function postToken(
  fetchFn: FetchLike,
  params: Record<string, string>,
): Promise<TokenResponse> {
  let res: Response
  try {
    // Le point d'API des jetons de Google attend un formulaire, pas du JSON :
    // envoyer du JSON ici produit un `invalid_request` bien réel. Le double
    // refuse pareillement tout corps qui n'est pas encodé en formulaire sur
    // cette route (voir `fake-google-api.ts`), donc une régression ici fait
    // tomber la suite.
    res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new GoogleOAuthError(`Google injoignable : ${message}`)
  }

  if (res.status >= 400) {
    throw new GoogleOAuthError(`Google a refusé la demande de jeton (HTTP ${res.status}).`)
  }
  return (await res.json()) as TokenResponse
}

/**
 * URL de la page de consentement Google.
 *
 * Le client OAuth est **passé en argument**, jamais lu ici. Ni dans
 * l'environnement — il se saisit à l'écran et vit chiffré en base — ni, à plus
 * forte raison, dans la requête HTTP : une `redirect_uri` qui viendrait d'un
 * paramètre ferait de ce départ un tremplin vers n'importe quel site sous
 * notre nom de domaine, et Google renverrait le code de consentement là-bas.
 * Ce module n'a accès ni à l'un ni à l'autre, ce qui rend la faute
 * impossible à commettre ici.
 */
export function buildConsentUrl(args: { client: GoogleOAuthClient; state: string }): string {
  const params = new URLSearchParams({
    client_id: args.client.clientId,
    redirect_uri: args.client.redirectUri,
    response_type: 'code',
    scope: SCOPES,
    // Le jeton de rafraîchissement est ce qui permet de synchroniser en fond
    // sans que l'utilisateur soit devant l'écran.
    access_type: 'offline',
    // Google ne renvoie ce jeton qu'au premier consentement, sauf si on le
    // redemande explicitement : sans cela, une reconnexion serait inutilisable.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: args.state,
  })
  return `${CONSENT_URL}?${params.toString()}`
}

/**
 * Échange le code de consentement contre le couple de jetons.
 *
 * L'absence de jeton de rafraîchissement est traitée comme un échec : sans
 * lui, la connexion paraîtrait établie et cesserait de fonctionner une heure
 * plus tard, sans que rien ne l'explique à l'utilisateur.
 */
export async function exchangeCode(
  fetchFn: FetchLike,
  client: GoogleOAuthClient,
  code: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date; scope: string }> {
  const body = await postToken(fetchFn, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    // La même URL de retour qu'au départ, et pour la même raison : Google la
    // recompare ici. Elle vient de la configuration enregistrée, jamais de la
    // requête qui a déclenché l'échange.
    redirect_uri: client.redirectUri,
    grant_type: 'authorization_code',
    code,
  })

  if (
    typeof body.access_token !== 'string' ||
    body.access_token === '' ||
    typeof body.refresh_token !== 'string' ||
    body.refresh_token === ''
  ) {
    throw new GoogleOAuthError(
      "Google n'a pas renvoyé de jeton de rafraîchissement. Révoquez l'accès dans votre compte Google, puis reconnectez-vous.",
    )
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
    scope: body.scope ?? SCOPES,
  }
}

/**
 * Renouvelle le seul jeton d'accès. Le jeton de rafraîchissement, lui, ne
 * bouge pas : c'est le secret de longue durée, et Google ne le renvoie qu'au
 * premier consentement.
 */
export async function refreshAccessToken(
  fetchFn: FetchLike,
  client: GoogleOAuthClient,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const body = await postToken(fetchFn, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  if (typeof body.access_token !== 'string' || body.access_token === '') {
    throw new GoogleOAuthError("Google n'a pas renvoyé de jeton d'accès.")
  }

  return {
    accessToken: body.access_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3600) * 1000),
  }
}

export { postToken, type TokenResponse }
