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

function toBody(draft: CalendarEventDraft): Record<string, unknown> {
  return {
    summary: draft.summary,
    description: draft.description,
    start: { dateTime: draft.startLocal, timeZone: draft.timeZone },
    end: { dateTime: draft.endLocal, timeZone: draft.timeZone },
    transparency: draft.transparency,
    colorId: draft.colorId,
    extendedProperties: { private: { craEntryId: draft.craEntryId } },
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

export function createGoogleCalendarConnector(args: {
  fetchFn: FetchLike
  accessToken: string
  calendarId: string
}): CalendarConnector {
  const { fetchFn, accessToken, calendarId } = args
  const events = `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`

  return {
    dedicatedCalendarId: calendarId,

    async createEvent(draft) {
      const raw = (await request(fetchFn, accessToken, 'POST', events, toBody(draft))) as GoogleEvent
      return { externalId: raw.id, etag: raw.etag }
    },

    async updateEvent(externalId, draft) {
      const raw = (await request(
        fetchFn,
        accessToken,
        'PUT',
        `${events}/${encodeURIComponent(externalId)}`,
        toBody(draft),
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
