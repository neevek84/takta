import type { FetchLike } from './calendar'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

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
    // envoyer du JSON ici produit un `invalid_request` que rien dans les tests
    // ne rattraperait, puisque le double, lui, accepterait les deux.
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
 * Renouvelle le seul jeton d'accès. Le jeton de rafraîchissement, lui, ne
 * bouge pas : c'est le secret de longue durée, et Google ne le renvoie qu'au
 * premier consentement.
 */
export async function refreshAccessToken(
  fetchFn: FetchLike,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const body = await postToken(fetchFn, {
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
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
