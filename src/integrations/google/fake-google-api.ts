/**
 * Double en mémoire de l'API Google Calendar.
 *
 * **Aucun test n'appelle Google.** Ce fichier est le seul « Google » que la
 * suite connaisse ; il n'est jamais importé par le code applicatif. Il rejoue
 * les codes de retour qui comptent — 200, 400, 401, 404, 410, 503 — et les
 * pannes de transport, pour que le connecteur réel soit exercé tel quel. Le
 * 400 se déclenche aussi à la demande (`failNext('REQUETE')`) : c'est le seul
 * moyen d'exercer la frontière entre échec définitif et échec transitoire sur
 * une requête que le double jugerait par ailleurs valide.
 *
 * Il refuse ce que la vraie API refuserait : jeton absent, borne manquante,
 * heure mal formée, couleur hors palette, route inconnue, corps JSON envoyé
 * là où l'échange de jeton exige un formulaire. Un double complaisant
 * validerait un connecteur qui ne marcherait pas.
 */
import type { FetchLike } from './calendar'

export interface FakeCall {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

interface FakeEvent {
  id: string
  etag: string
  status: string
  body: Record<string, unknown>
}

export interface FakeGoogleApi {
  fetchFn: FetchLike
  calls: FakeCall[]
  events: Map<string, FakeEvent>
  /** plages occupées rendues par freeBusy, par identifiant de calendrier */
  busy: Map<string, Array<{ start: string; end: string }>>
  /** calendriers créés, par identifiant */
  calendars: Map<string, { id: string; summary: string }>
  /** jetons acceptés par l'échange OAuth, pour les tâches 7 et 10 */
  oauth: { accessToken: string; refreshToken: string; expiresIn: number; refusRefresh: boolean }

  failNext(mode: 'RESEAU' | 'EXPIRE' | 'SERVEUR' | 'REQUETE'): void
  expirerJeton(): void
  retablirJeton(): void
  toucherEvenement(
    id: string,
    patch?: { summary?: string; startLocal?: string; endLocal?: string },
  ): void
  supprimerEvenement(id: string, options?: { gone?: boolean }): void
  annulerEvenement(id: string): void
  dernierAppel(): FakeCall
  appelsVers(fragment: string): FakeCall[]
}

const BASE = 'https://www.googleapis.com/calendar/v3'

/** Heure locale naïve : l'instant n'est défini que si un fuseau l'accompagne. */
const HEURE_NAIVE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/
/** Instant absolu RFC 3339 : le décalage se suffit à lui-même. */
const INSTANT_ABSOLU = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** La palette d'événements de Google s'arrête à onze couleurs. */
const COULEURS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
}

/** Rend le message d'erreur, ou `null` quand la borne est acceptable. */
function verifierBorne(nom: string, borne: unknown): string | null {
  if (!estObjet(borne)) return `Missing ${nom} time.`

  const dateTime = borne.dateTime
  if (typeof dateTime !== 'string') return `Missing ${nom} time.`

  if (INSTANT_ABSOLU.test(dateTime)) return null
  if (!HEURE_NAIVE.test(dateTime)) return `Invalid value for: ${dateTime}`

  const timeZone = borne.timeZone
  if (typeof timeZone !== 'string' || timeZone === '') {
    return `Cannot specify a naive ${nom} time without a time zone.`
  }
  return null
}

function verifierEvenement(body: unknown): string | null {
  if (!estObjet(body)) return 'Required'

  const debut = verifierBorne('start', body.start)
  if (debut !== null) return debut
  const fin = verifierBorne('end', body.end)
  if (fin !== null) return fin

  if (body.summary !== undefined && typeof body.summary !== 'string') {
    return 'Invalid value for: summary'
  }
  if (
    body.transparency !== undefined &&
    body.transparency !== 'opaque' &&
    body.transparency !== 'transparent'
  ) {
    return `Invalid value for: ${String(body.transparency)}`
  }
  if (body.colorId !== undefined && !COULEURS.has(String(body.colorId))) {
    return `Invalid color id: ${String(body.colorId)}`
  }

  if (body.extendedProperties !== undefined) {
    const proprietes = body.extendedProperties
    if (!estObjet(proprietes)) return 'Invalid value for: extendedProperties'
    const privees = proprietes.private
    if (privees !== undefined) {
      if (!estObjet(privees)) return 'Invalid value for: extendedProperties.private'
      for (const valeur of Object.values(privees)) {
        if (typeof valeur !== 'string') return 'Invalid value for: extendedProperties.private'
      }
    }
  }

  return null
}

function verifierFreeBusy(body: unknown): string | null {
  if (!estObjet(body)) return 'Required'

  for (const borne of ['timeMin', 'timeMax'] as const) {
    const valeur = body[borne]
    if (typeof valeur !== 'string') return `Missing ${borne}.`
    if (!INSTANT_ABSOLU.test(valeur)) return `Invalid value for: ${borne}`
  }

  const items = body.items
  if (!Array.isArray(items)) return 'Missing items.'
  for (const item of items) {
    if (!estObjet(item) || typeof item.id !== 'string') return 'Invalid value for: items'
  }
  return null
}

export function createFakeGoogleApi(): FakeGoogleApi {
  const calls: FakeCall[] = []
  const events = new Map<string, FakeEvent>()
  const busy = new Map<string, Array<{ start: string; end: string }>>()
  const calendars = new Map<string, { id: string; summary: string }>()
  const gone = new Set<string>()
  const oauth = {
    accessToken: 'ya29.nouveau',
    refreshToken: '1//rafraichissement',
    expiresIn: 3600,
    refusRefresh: false,
  }

  let prochainEchec: 'RESEAU' | 'EXPIRE' | 'SERVEUR' | 'REQUETE' | null = null
  let jetonExpire = false
  let seq = 0

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  function erreur(status: number, message: string): Response {
    return json({ error: { code: status, message } }, status)
  }

  /** Le connecteur envoie du JSON, l'échange de jetons un formulaire. */
  function lireCorps(init: { headers: Record<string, string>; body?: string }): unknown {
    if (init.body === undefined) return null
    if ((init.headers['content-type'] ?? '').includes('x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(init.body))
    }
    return JSON.parse(init.body)
  }

  const fetchFn: FetchLike = async (url, init) => {
    const body: unknown = lireCorps(init)
    calls.push({ method: init.method, url, headers: init.headers, body })

    if (prochainEchec !== null) {
      const mode = prochainEchec
      prochainEchec = null
      if (mode === 'RESEAU') throw new Error('fetch failed')
      if (mode === 'EXPIRE') {
        const err = new Error("Le délai d'attente est dépassé")
        err.name = 'TimeoutError'
        throw err
      }
      // Refus définitif, à distinguer du 503 : rejouer donnerait le même refus.
      if (mode === 'REQUETE') return erreur(400, 'Invalid value')
      return json({ error: { message: 'Backend error' } }, 503)
    }

    // L'échange de jeton n'est pas soumis à l'expiration du jeton d'accès.
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      // Google exige un corps de formulaire pour ce point d'échange, jamais
      // du JSON : un connecteur qui enverrait du JSON ici recevrait un
      // `invalid_request` bien réel. Sans ce contrôle, `lireCorps` acceptait
      // les deux indifféremment et ce défaut n'était retenu par rien (voir I7
      // de la revue).
      if (!(init.headers['content-type'] ?? '').includes('x-www-form-urlencoded')) {
        return erreur(400, 'invalid_request')
      }
      if (oauth.refusRefresh) return json({ error: 'invalid_grant' }, 400)
      return json({
        access_token: oauth.accessToken,
        refresh_token: oauth.refreshToken,
        expires_in: oauth.expiresIn,
        scope: 'https://www.googleapis.com/auth/calendar',
        token_type: 'Bearer',
      })
    }

    // Toute route du calendrier exige un jeton porteur : sans ce contrôle, un
    // connecteur qui oublierait l'en-tête passerait la suite au vert.
    const porteur = /^Bearer .+$/.test(init.headers.authorization ?? '')
    if (!porteur || jetonExpire) return erreur(401, 'Invalid Credentials')

    if (url === `${BASE}/freeBusy`) {
      const invalide = verifierFreeBusy(body)
      if (invalide !== null) return erreur(400, invalide)

      const demande = body as { items: Array<{ id: string }> }
      const calendriers: Record<string, { busy: Array<{ start: string; end: string }> }> = {}
      for (const item of demande.items) calendriers[item.id] = { busy: busy.get(item.id) ?? [] }
      return json({ calendars: calendriers })
    }

    if (url === `${BASE}/calendars` && init.method === 'POST') {
      if (!estObjet(body) || typeof body.summary !== 'string' || body.summary === '') {
        return erreur(400, 'Missing summary.')
      }
      seq += 1
      const id = `cal-${seq}@group.calendar.google.com`
      calendars.set(id, { id, summary: body.summary })
      return json({ id, summary: body.summary })
    }

    if (url.startsWith(`${BASE}/users/me/calendarList`)) {
      return json({ items: [...calendars.values()] })
    }

    const evenements = /\/calendars\/[^/]+\/events(?:\/([^/?]+))?/.exec(url)
    if (evenements !== null) {
      const id = evenements[1] === undefined ? null : decodeURIComponent(evenements[1])

      if (id === null && init.method === 'POST') {
        const invalide = verifierEvenement(body)
        if (invalide !== null) return erreur(400, invalide)

        seq += 1
        const nouveau: FakeEvent = {
          id: `evt-${seq}`,
          etag: '"1"',
          status: 'confirmed',
          body: body as Record<string, unknown>,
        }
        events.set(nouveau.id, nouveau)
        return json({ ...nouveau.body, id: nouveau.id, etag: nouveau.etag, status: 'confirmed' })
      }

      if (id !== null) {
        if (gone.has(id)) return erreur(410, 'Resource has been deleted')

        const existant = events.get(id)
        if (existant === undefined) return erreur(404, 'Not Found')

        if (init.method === 'GET') {
          return json({
            ...existant.body,
            id: existant.id,
            etag: existant.etag,
            status: existant.status,
          })
        }

        if (init.method === 'PUT' || init.method === 'PATCH') {
          const invalide = verifierEvenement(body)
          if (invalide !== null) return erreur(400, invalide)

          existant.body = body as Record<string, unknown>
          existant.etag = `"${Number(existant.etag.replaceAll('"', '')) + 1}"`
          return json({ ...existant.body, id: existant.id, etag: existant.etag })
        }

        if (init.method === 'DELETE') {
          events.delete(id)
          return new Response(null, { status: 204 })
        }
      }
    }

    return erreur(404, `Route non simulée : ${init.method} ${url}`)
  }

  return {
    fetchFn,
    calls,
    events,
    busy,
    calendars,
    oauth,

    failNext(mode) {
      prochainEchec = mode
    },
    expirerJeton() {
      jetonExpire = true
    },
    retablirJeton() {
      jetonExpire = false
    },
    toucherEvenement(id, patch) {
      const e = events.get(id)
      if (e === undefined) throw new Error(`Événement inconnu du double : ${id}`)

      const bornes = e.body as {
        start?: { dateTime?: string; timeZone?: string }
        end?: { dateTime?: string; timeZone?: string }
      }
      if (patch?.summary !== undefined) e.body = { ...e.body, summary: patch.summary }
      if (patch?.startLocal !== undefined) {
        e.body = { ...e.body, start: { ...bornes.start, dateTime: patch.startLocal } }
      }
      if (patch?.endLocal !== undefined) {
        e.body = { ...e.body, end: { ...bornes.end, dateTime: patch.endLocal } }
      }

      // Google fait bouger l'etag à chaque modification : c'est exactement
      // l'empreinte sur laquelle repose toute la détection de divergence.
      e.etag = `"${Number(e.etag.replaceAll('"', '')) + 1}"`
    },
    supprimerEvenement(id, options) {
      events.delete(id)
      if (options?.gone === true) gone.add(id)
    },
    annulerEvenement(id) {
      const e = events.get(id)
      if (e === undefined) throw new Error(`Événement inconnu du double : ${id}`)
      e.status = 'cancelled'
    },
    dernierAppel() {
      const dernier = calls[calls.length - 1]
      if (dernier === undefined) throw new Error('Aucun appel enregistré par le double.')
      return dernier
    },
    appelsVers(fragment) {
      return calls.filter((c) => c.url.includes(fragment))
    },
  }
}
