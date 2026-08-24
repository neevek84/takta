import { describe, it, expect, beforeEach } from 'vitest'
import { CalendarApiError } from '@/core/calendar/connector'
import { buildCalendarEvent } from '@/core/calendar/event'
import {
  createGoogleCalendarConnector,
  ensureDedicatedCalendar,
  getPrimaryCalendarEmail,
} from './calendar'
import { createFakeGoogleApi, type FakeGoogleApi } from './fake-google-api'
import { exchangeCode } from './oauth'

const DEDIE = 'cra-dedie@group.calendar.google.com'

let api: FakeGoogleApi

function connector(calendarId = DEDIE, ownerEmail?: string) {
  return createGoogleCalendarConnector({
    fetchFn: api.fetchFn,
    accessToken: 'ya29.acces',
    calendarId,
    ...(ownerEmail === undefined ? {} : { ownerEmail }),
  })
}

function draft(entryId = 'entry-1') {
  return buildCalendarEvent({
    entryId,
    date: '2026-03-10',
    kind: 'REALISE',
    clientName: 'Acme',
    missionLabel: 'Refonte',
    lineLabel: 'Développement',
    startMinute: 540,
    endMinute: 1020,
    timeZone: 'Europe/Paris',
  })
}

beforeEach(() => {
  api = createFakeGoogleApi()
})

describe('création et mise à jour', () => {
  it('crée un événement et rend son etag', async () => {
    const r = await connector().createEvent(draft())
    expect(r.externalId).not.toBe('')
    expect(r.etag).not.toBe('')
  })

  it('pousse le corps attendu', async () => {
    await connector().createEvent(draft())
    const corps = api.dernierAppel().body as Record<string, unknown>

    expect(corps.summary).toBe('Acme · Refonte · Développement')
    expect(corps.transparency).toBe('opaque')
    expect(corps.colorId).toBe('9')
    expect(corps.start).toEqual({ dateTime: '2026-03-10T09:00:00', timeZone: 'Europe/Paris' })
    expect(corps.end).toEqual({ dateTime: '2026-03-10T17:00:00', timeZone: 'Europe/Paris' })
    expect(corps.extendedProperties).toEqual({ private: { craEntryId: 'entry-1' } })
  })

  it('écrit dans le calendrier dédié, jamais dans l agenda principal', async () => {
    await connector().createEvent(draft())
    expect(api.dernierAppel().url).toContain(encodeURIComponent(DEDIE))
    expect(api.dernierAppel().url).not.toContain('/calendars/primary/')
  })

  it('porte le jeton d accès', async () => {
    await connector().createEvent(draft())
    expect(api.dernierAppel().headers.authorization).toBe('Bearer ya29.acces')
  })

  it('fait changer l etag à chaque mise à jour', async () => {
    const c = connector()
    const cree = await c.createEvent(draft())
    const maj = await c.updateEvent(cree.externalId, draft())
    expect(maj.etag).not.toBe(cree.etag)
  })
})

describe('relecture', () => {
  it('rend l etag courant et l identifiant de saisie', async () => {
    const c = connector()
    const cree = await c.createEvent(draft('entry-42'))
    const lu = await c.getEvent(cree.externalId)

    expect(lu.etag).toBe(cree.etag)
    expect(lu.craEntryId).toBe('entry-42')
    expect(lu.startLocal).toBe('2026-03-10T09:00:00')
  })

  it('voit l etag bouger quand Google modifie l événement', async () => {
    const c = connector()
    const cree = await c.createEvent(draft())
    api.toucherEvenement(cree.externalId, { summary: 'Déplacé à la main' })

    const lu = await c.getEvent(cree.externalId)
    expect(lu.etag).not.toBe(cree.etag)
    expect(lu.summary).toBe('Déplacé à la main')
  })

  it('traduit un 404 en NOT_FOUND', async () => {
    await expect(connector().getEvent('inconnu')).rejects.toMatchObject({
      name: 'CalendarApiError',
      kind: 'NOT_FOUND',
    })
  })

  it('traduit un 410 en NOT_FOUND', async () => {
    const c = connector()
    const cree = await c.createEvent(draft())
    api.supprimerEvenement(cree.externalId, { gone: true })

    await expect(c.getEvent(cree.externalId)).rejects.toMatchObject({ kind: 'NOT_FOUND' })
  })

  it('traite un événement annulé comme disparu', async () => {
    const c = connector()
    const cree = await c.createEvent(draft())
    api.annulerEvenement(cree.externalId)

    await expect(c.getEvent(cree.externalId)).rejects.toMatchObject({ kind: 'NOT_FOUND' })
  })
})

describe('suppression', () => {
  it('supprime l événement', async () => {
    const c = connector()
    const cree = await c.createEvent(draft())
    await c.deleteEvent(cree.externalId)
    expect(api.events.has(cree.externalId)).toBe(false)
  })

  it('réussit sur un événement déjà absent', async () => {
    // Objectif atteint : l'événement n'est plus là. Échouer ici ferait tourner
    // la file en boucle sur une suppression déjà faite.
    await expect(connector().deleteEvent('inconnu')).resolves.toBeUndefined()
  })
})

describe('lecture d occupation', () => {
  it('exclut le calendrier dédié de la requête', async () => {
    // Sans cette exclusion, les blocs poussés par l'application entreraient en
    // conflit avec eux-mêmes.
    await connector().freeBusy({
      startIso: '2026-03-01T00:00:00.000Z',
      endIso: '2026-04-01T00:00:00.000Z',
      calendarIds: ['primary', DEDIE],
    })

    const corps = api.dernierAppel().body as { items: Array<{ id: string }> }
    expect(corps.items).toEqual([{ id: 'primary' }])
  })

  it('rend les plages occupées', async () => {
    api.busy.set('primary', [
      { start: '2026-03-12T08:00:00.000Z', end: '2026-03-12T10:00:00.000Z' },
    ])

    const plages = await connector().freeBusy({
      startIso: '2026-03-01T00:00:00.000Z',
      endIso: '2026-04-01T00:00:00.000Z',
      calendarIds: ['primary', DEDIE],
    })

    expect(plages).toEqual([
      { startIso: '2026-03-12T08:00:00.000Z', endIso: '2026-03-12T10:00:00.000Z' },
    ])
  })

  it('ne rend rien quand rien n est occupé', async () => {
    const plages = await connector().freeBusy({
      startIso: '2026-03-01T00:00:00.000Z',
      endIso: '2026-04-01T00:00:00.000Z',
      calendarIds: ['primary'],
    })
    expect(plages).toEqual([])
  })
})

describe('adresse du compte connecté', () => {
  it('rend l identifiant du calendrier primary, littéralement l adresse du compte', async () => {
    api.primaryEmail = 'porteur@exemple.test'
    await expect(getPrimaryCalendarEmail(api.fetchFn, 'ya29.acces')).resolves.toBe(
      'porteur@exemple.test',
    )
  })
})

describe('invité — libre/occupé de l agenda principal', () => {
  const COMPTE = 'compte@exemple.test'

  it('invite le compte connecté sur le bloc qu il pose lui-même', async () => {
    await connector(DEDIE, COMPTE).createEvent(draft())
    const corps = api.dernierAppel().body as { attendees?: Array<{ email: string }> }
    expect(corps.attendees).toEqual([{ email: COMPTE, responseStatus: 'accepted' }])
  })

  it('ne pose aucun invité sans adresse connue', async () => {
    // Compatibilité avec une connexion antérieure à ce correctif, dont
    // `ownerEmail` n'a pas encore été rempli.
    await connector(DEDIE).createEvent(draft())
    const corps = api.dernierAppel().body as { attendees?: unknown }
    expect(corps.attendees).toBeUndefined()
  })

  it('reporte l invité sur chaque mise à jour', async () => {
    const c = connector(DEDIE, COMPTE)
    const cree = await c.createEvent(draft())
    await c.updateEvent(cree.externalId, draft())

    const corps = api.dernierAppel().body as { attendees?: Array<{ email: string }> }
    expect(corps.attendees).toEqual([{ email: COMPTE, responseStatus: 'accepted' }])
  })

  it('n envoie aucun courriel d invitation : sendUpdates=none', async () => {
    const c = connector(DEDIE, COMPTE)
    const cree = await c.createEvent(draft())
    expect(api.dernierAppel().url).toContain('sendUpdates=none')

    await c.updateEvent(cree.externalId, draft())
    expect(api.dernierAppel().url).toContain('sendUpdates=none')
  })
})

describe('calendrier dédié — partage libre/occupé', () => {
  // Sans cette règle, un calendrier secondaire fraîchement créé reste privé :
  // un tiers qui invite l'utilisateur dans Google Calendar ne le voit jamais
  // occupé pendant un bloc CRA, même marqué `opaque`.
  it('ouvre le libre/occupé en portée publique à la création', async () => {
    const calendarId = await ensureDedicatedCalendar(api.fetchFn, 'ya29.acces', 'CRA — disponibilités')
    expect(api.acl.get(calendarId)).toEqual([{ role: 'freeBusyReader', scope: { type: 'default' } }])
  })

  it('ne repose pas la règle quand le calendrier est retrouvé déjà ouvert', async () => {
    const premier = await ensureDedicatedCalendar(api.fetchFn, 'ya29.acces', 'CRA — disponibilités')
    const second = await ensureDedicatedCalendar(api.fetchFn, 'ya29.acces', 'CRA — disponibilités')

    expect(second).toBe(premier)
    expect(api.acl.get(premier)).toHaveLength(1)
  })

  it('respecte un partage déjà plus large sans le rétrograder', async () => {
    const calendarId = await ensureDedicatedCalendar(api.fetchFn, 'ya29.acces', 'CRA — disponibilités')
    api.acl.set(calendarId, [{ role: 'reader', scope: { type: 'default' } }])

    await ensureDedicatedCalendar(api.fetchFn, 'ya29.acces', 'CRA — disponibilités')
    expect(api.acl.get(calendarId)).toEqual([{ role: 'reader', scope: { type: 'default' } }])
  })
})

describe('pannes', () => {
  it('traduit une coupure réseau en UNAVAILABLE', async () => {
    api.failNext('RESEAU')
    await expect(connector().createEvent(draft())).rejects.toMatchObject({ kind: 'UNAVAILABLE' })
  })

  it('traduit un délai dépassé en UNAVAILABLE', async () => {
    api.failNext('EXPIRE')
    await expect(connector().createEvent(draft())).rejects.toMatchObject({ kind: 'UNAVAILABLE' })
  })

  it('traduit un 503 en UNAVAILABLE', async () => {
    api.failNext('SERVEUR')
    await expect(connector().createEvent(draft())).rejects.toMatchObject({ kind: 'UNAVAILABLE' })
  })

  // Un 400 ne guérit pas en attendant : le distinguer d'un 503 est ce qui
  // évite de rejouer cinq fois une requête définitivement mal formée.
  it('traduit un 400 en INVALID, jamais en UNAVAILABLE', async () => {
    api.failNext('REQUETE')
    await expect(connector().createEvent(draft())).rejects.toMatchObject({ kind: 'INVALID' })
  })

  it('traduit un jeton expiré en UNAUTHORIZED', async () => {
    api.expirerJeton()
    await expect(connector().createEvent(draft())).rejects.toMatchObject({ kind: 'UNAUTHORIZED' })
  })

  it('n émet jamais autre chose qu une CalendarApiError', async () => {
    api.failNext('RESEAU')
    await expect(connector().createEvent(draft())).rejects.toBeInstanceOf(CalendarApiError)
  })

  it('ne rejoue pas la panne à l appel suivant', async () => {
    const c = connector()
    api.failNext('RESEAU')
    await expect(c.createEvent(draft())).rejects.toThrow()
    await expect(c.createEvent(draft())).resolves.toMatchObject({ etag: expect.any(String) })
  })
})

describe('aucun appel au réseau', () => {
  it('passe exclusivement par le transport injecté', async () => {
    const c = connector()
    await c.createEvent(draft())
    await c.freeBusy({
      startIso: '2026-03-01T00:00:00.000Z',
      endIso: '2026-04-01T00:00:00.000Z',
      calendarIds: ['primary'],
    })
    // Chaque requête est passée par le double : aucune n'a pu partir ailleurs.
    expect(api.calls.length).toBe(2)
  })
})

/**
 * Un double complaisant ne prouve rien : s'il accepte n'importe quelle charge
 * utile, la suite reste verte alors que Google refuserait la requête. Ces cas
 * fixent la sévérité du double — ils sont les seuls à l'appeler directement,
 * puisqu'un connecteur correct ne produit jamais ces requêtes-là.
 */
describe('sévérité du double', () => {
  const ENTETES = { authorization: 'Bearer ya29.acces', 'content-type': 'application/json' }

  /**
   * Aucune URL n'est écrite en dur ici : elle est relevée sur un appel réel du
   * connecteur. La sévérité porte donc sur les routes qu'il utilise vraiment,
   * et aucun test ne connaît d'adresse joignable.
   */
  async function urlEvents(): Promise<string> {
    await connector().createEvent(draft())
    // Sans le paramètre `sendUpdates` : ces cas construisent des URL dérivées
    // (`${base}/${id}`), et le connecteur le pose lui-même quand il en a
    // besoin — voir la « sévérité du double — invité » plus bas.
    return api.dernierAppel().url.split('?')[0] ?? ''
  }

  async function urlFreeBusy(): Promise<string> {
    await connector().freeBusy({
      startIso: '2026-03-01T00:00:00.000Z',
      endIso: '2026-04-01T00:00:00.000Z',
      calendarIds: ['primary'],
    })
    return api.dernierAppel().url
  }

  function corpsValide(patch: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      summary: 'Acme · Refonte · Développement',
      description: 'Bloc réalisé posé par le CRA.',
      start: { dateTime: '2026-03-10T09:00:00', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-03-10T17:00:00', timeZone: 'Europe/Paris' },
      transparency: 'opaque',
      colorId: '9',
      extendedProperties: { private: { craEntryId: 'entry-1' } },
      ...patch,
    }
  }

  async function poster(
    corps: unknown,
    headers: Record<string, string> = ENTETES,
    url?: string,
  ): Promise<Response> {
    return api.fetchFn(url ?? (await urlEvents()), {
      method: 'POST',
      headers,
      body: JSON.stringify(corps),
    })
  }

  it('accepte la charge utile que le connecteur envoie vraiment', async () => {
    // Garde-fou inverse : un double trop sévère rendrait la suite menteuse
    // dans l'autre sens.
    expect((await poster(corpsValide())).status).toBe(200)
  })

  it('refuse une requête sans en-tête d autorisation', async () => {
    const res = await poster(corpsValide(), { 'content-type': 'application/json' })
    expect(res.status).toBe(401)
  })

  it('refuse un jeton qui n est pas porteur', async () => {
    const res = await poster(corpsValide(), { ...ENTETES, authorization: 'ya29.acces' })
    expect(res.status).toBe(401)
  })

  it('refuse un événement sans borne de fin', async () => {
    const sansFin = corpsValide()
    delete sansFin.end
    expect((await poster(sansFin)).status).toBe(400)
  })

  it('refuse une heure locale mal formée', async () => {
    const res = await poster(
      corpsValide({ start: { dateTime: '2026-03-10 09:00', timeZone: 'Europe/Paris' } }),
    )
    expect(res.status).toBe(400)
  })

  it('refuse une heure naïve privée de son fuseau', async () => {
    // Sans fuseau ni décalage, l'instant est indéterminé : Google refuse, le
    // double aussi, sans quoi une régression sur le fuseau passerait inaperçue.
    const res = await poster(corpsValide({ start: { dateTime: '2026-03-10T09:00:00' } }))
    expect(res.status).toBe(400)
  })

  it('accepte un instant absolu sans fuseau séparé', async () => {
    const res = await poster(
      corpsValide({
        start: { dateTime: '2026-03-10T08:00:00Z' },
        end: { dateTime: '2026-03-10T16:00:00Z' },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('refuse une transparence inconnue', async () => {
    expect((await poster(corpsValide({ transparency: 'busy' }))).status).toBe(400)
  })

  it('refuse une couleur hors palette', async () => {
    expect((await poster(corpsValide({ colorId: '99' }))).status).toBe(400)
  })

  it('refuse une propriété privée non textuelle', async () => {
    const res = await poster(corpsValide({ extendedProperties: { private: { craEntryId: 42 } } }))
    expect(res.status).toBe(400)
  })

  it('refuse une mise à jour mal formée', async () => {
    const base = await urlEvents()
    const cree = [...api.events.keys()][0] as string
    const sansDebut = corpsValide()
    delete sansDebut.start

    const res = await api.fetchFn(`${base}/${cree}`, {
      method: 'PUT',
      headers: ENTETES,
      body: JSON.stringify(sansDebut),
    })
    expect(res.status).toBe(400)
  })

  it('refuse une lecture d occupation sans bornes', async () => {
    const res = await poster({ items: [{ id: 'primary' }] }, ENTETES, await urlFreeBusy())
    expect(res.status).toBe(400)
  })

  it('refuse une lecture d occupation sans liste de calendriers', async () => {
    const res = await poster(
      { timeMin: '2026-03-01T00:00:00.000Z', timeMax: '2026-04-01T00:00:00.000Z' },
      ENTETES,
      await urlFreeBusy(),
    )
    expect(res.status).toBe(400)
  })

  it('refuse une route qu il ne simule pas, en levant et non en 404', async () => {
    // Ce test rendait 404 avant que le double ne devienne le gardien du
    // catalogue. Un 404 est traduit par le connecteur en `NOT_FOUND`, que
    // `deleteEvent` avale : le refus doit lever pour se voir sur ce chemin.
    // `/acl` sert désormais un vrai usage (partage libre/occupé) ; `/watch`
    // reste absent du catalogue et tient donc ce rôle d'exemple non catalogué.
    const watch = (await urlEvents()).replace(/\/events$/, '/watch')
    await expect(api.fetchFn(watch, { method: 'GET', headers: ENTETES })).rejects.toThrow(
      /non catalogué/,
    )
  })
})

/**
 * I7 (revue adversariale lot 1b) — le point d'échange de jeton de Google
 * attend un corps `application/x-www-form-urlencoded`, jamais du JSON. Un
 * double qui accepterait les deux indifféremment validerait un connecteur qui
 * échouerait réellement contre Google (`invalid_request`), sans qu'aucun test
 * ne le rattrape.
 */
describe('sévérité du double — échange de jeton', () => {
  const TOKEN_URL = 'https://oauth2.googleapis.com/token'

  it('refuse un échange de jeton envoyé en JSON', async () => {
    const res = await api.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: 'client-id-de-test',
        client_secret: 'client-secret-de-test',
        redirect_uri: 'http://localhost:3000/api/google/callback',
        grant_type: 'authorization_code',
        code: 'code-de-consentement',
      }),
    })
    expect(res.status).toBe(400)
  })

  it('accepte la charge utile que le connecteur envoie vraiment', async () => {
    // Garde-fou inverse : un double trop sévère rendrait la suite menteuse
    // dans l'autre sens.
    const jetons = await exchangeCode(
      api.fetchFn,
      {
        clientId: 'client-id-de-test',
        clientSecret: 'client-secret-de-test',
        redirectUri: 'http://localhost:3000/api/google/callback',
      },
      'code-de-consentement',
    )
    expect(jetons.accessToken).not.toBe('')
    expect(jetons.refreshToken).not.toBe('')
  })
})

/**
 * Le double est le gardien du catalogue : ce qui n'y est pas déclaré ne passe
 * pas. Voir `src/integrations/google/catalogue.ts`.
 */
describe('le double refuse ce que le catalogue ne déclare pas', () => {
  it('lève sur une route absente du catalogue, sans la traduire en 404', async () => {
    await expect(
      api.fetchFn('https://www.googleapis.com/calendar/v3/settings', {
        method: 'GET',
        headers: { authorization: 'Bearer jeton-factice' },
      }),
    ).rejects.toThrow(/non catalogué[\s\S]*src\/integrations\/google\/catalogue\.ts/)
  })

  it('enregistre le gabarit catalogué de chaque appel reçu', async () => {
    await connector().createEvent(draft())
    expect(api.gabaritsObserves).toEqual(['POST /calendars/{calendarId}/events'])
  })

  it('refuse aussi une route non cataloguée quand une panne est armée', async () => {
    api.failNext('SERVEUR')
    await expect(
      api.fetchFn('https://www.googleapis.com/calendar/v3/settings', {
        method: 'GET',
        headers: { authorization: 'Bearer jeton-factice' },
      }),
    ).rejects.toThrow(/non catalogué/)
  })
})
