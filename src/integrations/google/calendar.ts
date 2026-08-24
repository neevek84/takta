import {
  CalendarApiError,
  type BusyInterval,
  type CalendarConnector,
  type RemoteEvent,
} from '@/core/calendar/connector'
import type { CalendarEventDraft } from '@/core/calendar/event'

const BASE = 'https://www.googleapis.com/calendar/v3'

/**
 * Le transport est toujours injecté — c'est ce qui rend le connecteur testable
 * sans réseau, et donc testable tout court.
 */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>

interface GoogleEvent {
  id: string
  etag: string
  status?: string
  summary?: string
  start?: { dateTime?: string; timeZone?: string }
  end?: { dateTime?: string; timeZone?: string }
  extendedProperties?: { private?: Record<string, string> }
}

/**
 * `ownerEmail` s'invite lui-même sur le bloc — vide, aucun invité n'est posé.
 *
 * Un calendrier secondaire reste privé même partagé en `freeBusyReader` : ce
 * partage ouvre la lecture de *ce* calendrier précis, mais Google ne fusionne
 * jamais un calendrier secondaire dans le libre/occupé interrogé par
 * l'adresse `primary` du compte. Ce que Google agrège en revanche sous cette
 * adresse, ce sont les événements où elle figure comme invitée — quel que
 * soit le calendrier organisateur. S'inviter soi-même sur son propre bloc,
 * dans son propre calendrier dédié, suffit donc à faire porter l'occupation
 * jusqu'à l'agenda principal, sans jamais y écrire un événement.
 */
function toBody(draft: CalendarEventDraft, ownerEmail: string): Record<string, unknown> {
  return {
    summary: draft.summary,
    description: draft.description,
    start: { dateTime: draft.startLocal, timeZone: draft.timeZone },
    end: { dateTime: draft.endLocal, timeZone: draft.timeZone },
    transparency: draft.transparency,
    colorId: draft.colorId,
    extendedProperties: { private: { craEntryId: draft.craEntryId } },
    ...(ownerEmail === ''
      ? {}
      : { attendees: [{ email: ownerEmail, responseStatus: 'accepted' }] }),
  }
}

async function request(
  fetchFn: FetchLike,
  accessToken: string,
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  let res: Response
  try {
    res = await fetchFn(url, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (err) {
    // Coupure réseau, DNS, délai dépassé : traduits, jamais relayés bruts.
    const message = err instanceof Error ? err.message : String(err)
    throw new CalendarApiError('UNAVAILABLE', `Agenda injoignable : ${message}`)
  }

  if (res.status === 404 || res.status === 410) {
    throw new CalendarApiError('NOT_FOUND', "L'événement n'existe plus dans l'agenda.")
  }
  if (res.status === 401 || res.status === 403) {
    throw new CalendarApiError('UNAUTHORIZED', "L'autorisation Google est expirée ou révoquée.")
  }
  // Requête refusée pour son contenu : la rejouer donnerait le même refus.
  // 429 (quota) et 5xx restent transitoires et retombent dans `UNAVAILABLE`.
  if (res.status === 400 || res.status === 422) {
    throw new CalendarApiError('INVALID', `Requête refusée par l'agenda (HTTP ${res.status}).`)
  }
  if (res.status >= 400) {
    throw new CalendarApiError('UNAVAILABLE', `Agenda en erreur (HTTP ${res.status}).`)
  }
  if (res.status === 204) return null

  return (await res.json()) as unknown
}

function toRemote(raw: GoogleEvent): RemoteEvent {
  return {
    externalId: raw.id,
    etag: raw.etag,
    summary: raw.summary ?? '',
    startLocal: raw.start?.dateTime ?? '',
    endLocal: raw.end?.dateTime ?? '',
    timeZone: raw.start?.timeZone ?? '',
    craEntryId: raw.extendedProperties?.private?.craEntryId ?? '',
  }
}

interface AclRule {
  role: string
  scope?: { type: string }
}

/**
 * Ouvre la lecture libre/occupé du calendrier dédié à tout le monde, y
 * compris hors du domaine de l'utilisateur — sans quoi un client externe qui
 * l'invite à une réunion dans Google Calendar ne le voit jamais occupé : un
 * calendrier secondaire fraîchement créé est privé par défaut, et le rester
 * même avec des événements `opaque` viderait de son sens l'intention du lot 0
 * (« l'agenda est la surface de disponibilité »).
 *
 * Relit d'abord les règles existantes : un partage déjà plus large que
 * `freeBusyReader` ne doit pas être touché, seulement complété s'il manque
 * une portée `default`.
 */
async function assurerLibreOccupePublic(
  fetchFn: FetchLike,
  accessToken: string,
  calendarId: string,
): Promise<void> {
  const acl = `${BASE}/calendars/${encodeURIComponent(calendarId)}/acl`
  const liste = (await request(fetchFn, accessToken, 'GET', acl)) as { items?: AclRule[] }

  const dejaOuvert = (liste.items ?? []).some((regle) => regle.scope?.type === 'default')
  if (dejaOuvert) return

  await request(fetchFn, accessToken, 'POST', acl, {
    role: 'freeBusyReader',
    scope: { type: 'default' },
  })
}

/**
 * Retrouve le calendrier dédié par son libellé, ou le crée — et s'assure
 * dans les deux cas que son libre/occupé est partagé publiquement (voir
 * `assurerLibreOccupePublic`).
 *
 * Jamais l'agenda principal : le calendrier dédié est affichable ou masquable
 * d'un clic et effaçable d'un geste, ce qui est la condition pour que
 * l'application ait le droit d'y écrire.
 */
export async function ensureDedicatedCalendar(
  fetchFn: FetchLike,
  accessToken: string,
  summary: string,
): Promise<string> {
  const liste = (await request(
    fetchFn,
    accessToken,
    'GET',
    `${BASE}/users/me/calendarList?maxResults=250`,
  )) as { items?: Array<{ id: string; summary?: string }> }

  const existant = (liste.items ?? []).find((c) => c.summary === summary)
  const calendarId =
    existant !== undefined
      ? existant.id
      : (
          (await request(fetchFn, accessToken, 'POST', `${BASE}/calendars`, {
            summary,
          })) as { id: string }
        ).id

  await assurerLibreOccupePublic(fetchFn, accessToken, calendarId)
  return calendarId
}

/**
 * L'adresse du calendrier `primary` du compte connecté — littéralement
 * l'adresse du compte. Lue une fois à la connexion (voir `connect.ts`), pour
 * inviter le compte sur ses propres blocs sans lui demander de scope
 * supplémentaire : le calendrier `primary` est déjà couvert par le scope
 * `calendar` que l'application détient.
 */
export async function getPrimaryCalendarEmail(
  fetchFn: FetchLike,
  accessToken: string,
): Promise<string> {
  const raw = (await request(fetchFn, accessToken, 'GET', `${BASE}/calendars/primary`)) as {
    id: string
  }
  return raw.id
}

export function createGoogleCalendarConnector(args: {
  fetchFn: FetchLike
  accessToken: string
  calendarId: string
  /** adresse invitée sur chaque bloc ; vide, aucun invité n'est posé */
  ownerEmail?: string
}): CalendarConnector {
  const { fetchFn, accessToken, calendarId } = args
  const ownerEmail = args.ownerEmail ?? ''
  const events = `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`
  // `sendUpdates=none` : l'invité n'est autre que le compte qui écrit —
  // sans ce paramètre, Google lui enverrait un courriel d'invitation à
  // chaque bloc posé.
  const sansNotification = (url: string): string => `${url}?sendUpdates=none`

  return {
    dedicatedCalendarId: calendarId,

    async createEvent(draft) {
      const raw = (await request(
        fetchFn,
        accessToken,
        'POST',
        sansNotification(events),
        toBody(draft, ownerEmail),
      )) as GoogleEvent
      return { externalId: raw.id, etag: raw.etag }
    },

    async updateEvent(externalId, draft) {
      const raw = (await request(
        fetchFn,
        accessToken,
        'PUT',
        sansNotification(`${events}/${encodeURIComponent(externalId)}`),
        toBody(draft, ownerEmail),
      )) as GoogleEvent
      return { etag: raw.etag }
    },

    async getEvent(externalId) {
      const raw = (await request(
        fetchFn,
        accessToken,
        'GET',
        `${events}/${encodeURIComponent(externalId)}`,
      )) as GoogleEvent

      // Google conserve les événements annulés avec un 200 : sans cette
      // lecture, une suppression passerait pour une simple modification.
      if (raw.status === 'cancelled') {
        throw new CalendarApiError('NOT_FOUND', "L'événement a été annulé dans l'agenda.")
      }
      return toRemote(raw)
    },

    async deleteEvent(externalId) {
      try {
        await request(fetchFn, accessToken, 'DELETE', `${events}/${encodeURIComponent(externalId)}`)
      } catch (err) {
        // Un événement déjà disparu est un objectif atteint, pas un échec.
        if (err instanceof CalendarApiError && err.kind === 'NOT_FOUND') return
        throw err
      }
    },

    async freeBusy({ startIso, endIso, calendarIds }) {
      // L'exclusion vit ici, pas seulement chez l'appelant : sans elle, les
      // blocs poussés par l'application entreraient en conflit avec eux-mêmes.
      const items = calendarIds.filter((id) => id !== calendarId).map((id) => ({ id }))

      const raw = (await request(fetchFn, accessToken, 'POST', `${BASE}/freeBusy`, {
        timeMin: startIso,
        timeMax: endIso,
        items,
      })) as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> }

      const plages: BusyInterval[] = []
      for (const calendrier of Object.values(raw.calendars ?? {})) {
        for (const plage of calendrier.busy ?? []) {
          plages.push({ startIso: plage.start, endIso: plage.end })
        }
      }
      return plages
    },
  }
}
