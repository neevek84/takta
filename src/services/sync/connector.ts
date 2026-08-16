import type { CalendarConnector } from '@/core/calendar/connector'
import { PROVIDER_GOOGLE } from '@/core/sync/policy'
import { createGoogleCalendarConnector, type FetchLike } from '@/integrations/google/calendar'
import { refreshAccessToken } from '@/integrations/google/oauth'
import { getCredential, updateAccessToken } from '@/services/credentials'

/** Fuseau des blocs poussés. Un déploiement hors métropole le surcharge. */
export const TIME_ZONE = process.env.CRA_TIMEZONE ?? 'Europe/Paris'

/** Marge avant expiration : un jeton qui expire dans la minute est déjà mort. */
const MARGE_MS = 60_000

/**
 * Rend un connecteur prêt à l'emploi, ou `null`.
 *
 * `null` couvre tous les cas où l'agenda n'est pas joignable pour de bon :
 * compte non connecté, calendrier dédié absent, clé de chiffrement perdue,
 * rafraîchissement refusé. Un seul `null` à traiter chez l'appelant, et aucune
 * exception qui puisse remonter jusqu'à la page de saisie.
 */
export async function resolveConnector(
  userId: string,
  deps: { fetchFn?: FetchLike; now?: Date } = {},
): Promise<CalendarConnector | null> {
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as unknown as FetchLike)
  const now = deps.now ?? new Date()

  let creds: Awaited<ReturnType<typeof getCredential>>
  try {
    creds = await getCredential(userId, PROVIDER_GOOGLE)
  } catch {
    return null
  }
  if (creds === null || creds.calendarId === '') return null

  let accessToken = creds.accessToken
  if (creds.expiresAt.getTime() <= now.getTime() + MARGE_MS) {
    try {
      const renouvele = await refreshAccessToken(fetchFn, creds.refreshToken)
      accessToken = renouvele.accessToken
      await updateAccessToken(userId, PROVIDER_GOOGLE, renouvele.accessToken, renouvele.expiresAt)
    } catch {
      // Un rafraîchissement impossible se lit comme « non connecté » : la
      // saisie continue, la synchronisation reprendra à la reconnexion.
      return null
    }
  }

  return createGoogleCalendarConnector({ fetchFn, accessToken, calendarId: creds.calendarId })
}
