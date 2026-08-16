import type { CalendarEventDraft } from './event'

export type CalendarErrorKind = 'NOT_FOUND' | 'UNAUTHORIZED' | 'UNAVAILABLE' | 'INVALID'

/**
 * La seule erreur qu'un connecteur a le droit d'émettre.
 *
 * Quatre cas suffisent à décider quoi faire : `NOT_FOUND` ouvre un conflit,
 * `UNAUTHORIZED` se lit comme « non connecté », `UNAVAILABLE` se rejoue, et
 * `INVALID` s'abandonne. Toute exception brute qui remonterait jusqu'à la
 * saisie serait un défaut : une panne Google ne bloque jamais la saisie.
 *
 * `INVALID` est la seule famille définitive : une requête que l'agenda refuse
 * pour ce qu'elle contient ne guérira pas en attendant. La rejouer jusqu'au
 * quota noierait les vraies pannes dans du bruit — c'est cette distinction,
 * et pas le code HTTP, que le drainage lit.
 */
export class CalendarApiError extends Error {
  readonly kind: CalendarErrorKind

  constructor(kind: CalendarErrorKind, message: string) {
    super(message)
    this.name = 'CalendarApiError'
    this.kind = kind
  }
}

export interface RemoteEvent {
  externalId: string
  etag: string
  summary: string
  /** heure locale naïve, 'YYYY-MM-DDTHH:MM:SS' */
  startLocal: string
  endLocal: string
  timeZone: string
  /** vide quand l'événement ne vient pas du CRA */
  craEntryId: string
}

export interface BusyInterval {
  /** instant absolu ISO 8601 */
  startIso: string
  endIso: string
}

export interface CalendarConnector {
  /** le calendrier dédié — exclu de toute lecture d'occupation */
  readonly dedicatedCalendarId: string

  createEvent(draft: CalendarEventDraft): Promise<{ externalId: string; etag: string }>
  updateEvent(externalId: string, draft: CalendarEventDraft): Promise<{ etag: string }>
  /** lève `CalendarApiError('NOT_FOUND')` quand l'événement n'existe plus */
  getEvent(externalId: string): Promise<RemoteEvent>
  /** réussit quand l'événement est déjà absent : l'objectif est atteint */
  deleteEvent(externalId: string): Promise<void>
  freeBusy(args: {
    startIso: string
    endIso: string
    calendarIds: string[]
  }): Promise<BusyInterval[]>
}
