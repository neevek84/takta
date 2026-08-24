import type { CalendarConnector } from '@/core/calendar/connector'
import { PROVIDER_GOOGLE } from '@/core/sync/policy'
import { createGoogleCalendarConnector, type FetchLike } from '@/integrations/google/calendar'
import { refreshAccessToken } from '@/integrations/google/oauth'
import { getCredential, updateAccessToken } from '@/services/credentials'
import { readGoogleOAuthClient } from '@/services/google/oauth-client'
import { journalAvertissement, journalErreur } from '@/services/log'

/** Marge avant expiration : un jeton qui expire dans la minute est déjà mort. */
const MARGE_MS = 60_000

/**
 * Rend un connecteur prêt à l'emploi, ou `null`.
 *
 * `null` couvre tous les cas où l'agenda n'est pas joignable pour de bon :
 * compte non connecté, calendrier dédié absent, clé de chiffrement perdue,
 * rafraîchissement refusé. Un seul `null` à traiter chez l'appelant, et aucune
 * exception qui puisse remonter jusqu'à la page de saisie.
 *
 * Indistincts pour l'appelant, ces cas ne le sont plus pour l'exploitant :
 * chacun laisse une ligne, sauf le seul qui n'est pas une panne — le compte
 * jamais connecté, qui est l'état par défaut de toute installation et ne doit
 * pas remplir les journaux à chaque ouverture de mois.
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
  } catch (err) {
    journalErreur('sync.connecteur', err, { userId, etape: 'lecture-jetons' })
    return null
  }
  if (creds === null) return null
  if (creds.calendarId === '') {
    // Jetons présents, agenda absent : rien ne partira jamais, et l'écran dit
    // « non connecté ». Sans cette ligne, ce demi-état est invisible.
    journalAvertissement('sync.connecteur', { userId, raison: 'calendrier-absent' })
    return null
  }

  let accessToken = creds.accessToken
  if (creds.expiresAt.getTime() <= now.getTime() + MARGE_MS) {
    // Le renouvellement exige le client OAuth, qui vit en base comme le reste.
    // Effacé pendant qu'une personne restait connectée, ses jetons ne peuvent
    // plus être renouvelés : c'est « non connecté », et cela doit se lire.
    const client = await readGoogleOAuthClient()
    if (client === null) {
      journalAvertissement('sync.connecteur', { userId, raison: 'client-oauth-absent' })
      return null
    }
    try {
      const renouvele = await refreshAccessToken(fetchFn, client, creds.refreshToken)
      accessToken = renouvele.accessToken
      await updateAccessToken(userId, PROVIDER_GOOGLE, renouvele.accessToken, renouvele.expiresAt)
    } catch (err) {
      // Un rafraîchissement impossible se lit comme « non connecté » : la
      // saisie continue, la synchronisation reprendra à la reconnexion. Mais
      // « Google refuse le rafraîchissement » et « quota épuisé » ne sont pas
      // la même panne, et seul le message de l'exception les sépare.
      journalErreur('sync.connecteur', err, { userId, etape: 'rafraichissement' })
      return null
    }
  }

  return createGoogleCalendarConnector({
    fetchFn,
    accessToken,
    calendarId: creds.calendarId,
    ownerEmail: creds.ownerEmail,
  })
}
