import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry, getMonthEntries } from '@/services/time-entries'
import { saveCredential } from '@/services/credentials'
import { createGoogleCalendarConnector } from '@/integrations/google/calendar'
import { createFakeGoogleApi, type FakeGoogleApi } from '@/integrations/google/fake-google-api'
import type { BusyInterval, CalendarConnector } from '@/core/calendar/connector'
import { getBusyDays, getBusyRange } from './availability'

const DEDIE = 'cra-dedie@group.calendar.google.com'

let userId = ''
let autreId = ''
let lineA = ''
let api: FakeGoogleApi

function connector() {
  return createGoogleCalendarConnector({
    fetchFn: api.fetchFn,
    accessToken: 'ya29.acces',
    calendarId: DEDIE,
  })
}

async function connecter(expiresAt = new Date('2026-12-31T00:00:00.000Z')): Promise<void> {
  await saveCredential(userId, 'GOOGLE', {
    accessToken: 'ya29.acces',
    refreshToken: '1//valide',
    expiresAt,
    scope: 'calendar',
    calendarId: DEDIE,
  })
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  const u = await prisma.user.create({
    data: { email: 'occupation@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'occupation-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('OCCUPATION client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  lineA = (
    await createLine({ missionId: m.id, userId, label: 'A', soldCentiemes: 3000, tjmCents: 0 })
  ).id
})

beforeEach(async () => {
  api = createFakeGoogleApi()
  await prisma.syncOutbox.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreId] } } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['occupation@test.local', 'occupation-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'OCCUPATION client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('getBusyDays', () => {
  it('rend les jours occupés, dédoublonnés et triés', async () => {
    api.busy.set('primary', [
      { start: '2026-03-17T14:00:00.000Z', end: '2026-03-17T15:00:00.000Z' },
      { start: '2026-03-12T08:00:00.000Z', end: '2026-03-12T10:00:00.000Z' },
      { start: '2026-03-12T13:00:00.000Z', end: '2026-03-12T14:00:00.000Z' },
    ])

    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual([
      '2026-03-12',
      '2026-03-17',
    ])
  })

  // Sans cette exclusion, les blocs poussés par l'application entreraient en
  // conflit avec eux-mêmes et chaque jour saisi paraîtrait occupé.
  it('exclut le calendrier dédié de la requête', async () => {
    await getBusyDays(userId, '2026-03', { connector: connector() })

    const corps = api.dernierAppel().body as { items: Array<{ id: string }> }
    expect(corps.items).toEqual([{ id: 'primary' }])
    expect(JSON.stringify(corps)).not.toContain(DEDIE)
  })

  // La preuve par l'absurde de l'exclusion : le calendrier dédié porte une
  // occupation sur toutes les journées ouvrées, et aucune ne ressort.
  it('ne rend jamais occupés les jours que l application a elle-même poussés', async () => {
    api.busy.set(DEDIE, [{ start: '2026-03-12T08:00:00.000Z', end: '2026-03-12T17:00:00.000Z' }])

    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual([])
  })

  it('interroge exactement le mois demandé', async () => {
    await getBusyDays(userId, '2026-03', { connector: connector() })

    const corps = api.dernierAppel().body as { timeMin: string; timeMax: string }
    expect(corps.timeMin).toBe('2026-03-01T00:00:00.000Z')
    expect(corps.timeMax).toBe('2026-04-01T00:00:00.000Z')
  })

  it('interroge le bon mois en fin d année', async () => {
    // Décembre déborde sur l'année suivante : un mois + 1 naïf donnerait
    // « 2026-13-01 », que l'agenda refuserait.
    await getBusyDays(userId, '2026-12', { connector: connector() })

    const corps = api.dernierAppel().body as { timeMin: string; timeMax: string }
    expect(corps.timeMin).toBe('2026-12-01T00:00:00.000Z')
    expect(corps.timeMax).toBe('2027-01-01T00:00:00.000Z')
  })

  it('marque les deux jours d une plage qui franchit minuit', async () => {
    api.busy.set('primary', [{ start: '2026-03-12T22:00:00.000Z', end: '2026-03-13T06:00:00.000Z' }])
    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual([
      '2026-03-12',
      '2026-03-13',
    ])
  })

  it('marque toutes les journées d une absence de plusieurs jours', async () => {
    // Une semaine de congés est une seule plage : n'en marquer que les bornes
    // laisserait le milieu libre à l'écran.
    api.busy.set('primary', [{ start: '2026-03-09T00:00:00.000Z', end: '2026-03-14T00:00:00.000Z' }])

    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual([
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
    ])
  })

  it('ne rend aucun jour hors du mois affiché', async () => {
    api.busy.set('primary', [
      { start: '2026-02-27T09:00:00.000Z', end: '2026-02-27T10:00:00.000Z' },
      { start: '2026-03-31T22:00:00.000Z', end: '2026-04-01T06:00:00.000Z' },
    ])
    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual(['2026-03-31'])
  })

  it('ne rend rien quand rien n est occupé', async () => {
    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual([])
  })

  it('n invente aucun jour à partir d une plage vide ou inversée', async () => {
    api.busy.set('primary', [
      { start: '2026-03-12T09:00:00.000Z', end: '2026-03-12T09:00:00.000Z' },
      { start: '2026-03-18T11:00:00.000Z', end: '2026-03-18T09:00:00.000Z' },
      { start: 'pas une date', end: '2026-03-20T09:00:00.000Z' },
    ])

    expect(await getBusyDays(userId, '2026-03', { connector: connector() })).toEqual([])
  })
})

describe('résilience — la panne ne casse jamais la saisie', () => {
  it('compte non connecté : aucune marque, aucune exception', async () => {
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  it('appel en échec : aucune marque', async () => {
    await connecter()
    api.failNext('SERVEUR')
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  it('appel expiré : aucune marque', async () => {
    await connecter()
    api.failNext('EXPIRE')
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  it('réseau coupé : aucune marque', async () => {
    await connecter()
    api.failNext('RESEAU')
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  it('autorisation révoquée : aucune marque', async () => {
    await connecter()
    api.expirerJeton()
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  it('jeton expiré et non rafraîchissable : aucune marque', async () => {
    await connecter(new Date('2020-01-01T00:00:00.000Z'))
    api.oauth.refusRefresh = true
    await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
  })

  it('clé de chiffrement perdue : aucune marque', async () => {
    await connecter()
    const cle = process.env.CREDENTIALS_KEY
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
    try {
      await expect(getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })).resolves.toEqual([])
    } finally {
      process.env.CREDENTIALS_KEY = cle
    }
  })

  // Le test qui protège le cas d'usage quotidien : la page de saisie reste
  // entièrement fonctionnelle pendant que Google est indisponible.
  it('la page de saisie reste fonctionnelle dans tous ces cas', async () => {
    await connecter()
    api.failNext('EXPIRE')

    const jours = await getBusyDays(userId, '2026-03', { fetchFn: api.fetchFn })
    const r = await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-12',
      minutes: 480,
      kind: 'REALISE',
    })
    const entries = await getMonthEntries(userId, '2026-03')

    expect(jours).toEqual([])
    expect(r).toEqual({ ok: true, minutes: 480 })
    expect(entries.length).toBe(1)
  })
})

describe('isolation par utilisateur', () => {
  it('ne lit pas l agenda d un autre utilisateur', async () => {
    await connecter()
    // L'autre utilisateur n'a aucun compte connecté : aucune requête ne part.
    expect(await getBusyDays(autreId, '2026-03', { fetchFn: api.fetchFn })).toEqual([])
    expect(api.calls.length).toBe(0)
  })
})

// Le `catch` du service protège d'un agenda en panne. Il ne protège de rien
// contre un agenda lent, qui répondra — plus tard — et retiendra d'ici là
// l'affichage de la saisie. Le marquage est une information, jamais un
// blocage : il ne vaut pas d'être attendu.
describe('agenda lent', () => {
  it('rend la main sans marquage plutôt que de retenir la page', async () => {
    const lent = {
      dedicatedCalendarId: 'dedie',
      freeBusy: () => new Promise<never>(() => {}),
    } as unknown as CalendarConnector

    const debut = Date.now()
    const jours = await getBusyDays(userId, '2026-03', { connector: lent, delaiMs: 40 })

    expect(jours).toEqual([])
    expect(Date.now() - debut).toBeLessThan(2000)
  })

  it('laisse passer une réponse arrivée dans le délai', async () => {
    await connecter()
    api.busy.set('primary', [
      { start: '2026-03-12T09:00:00.000Z', end: '2026-03-12T17:00:00.000Z' },
    ])

    const jours = await getBusyDays(userId, '2026-03', {
      fetchFn: api.fetchFn,
      delaiMs: 5000,
    })

    expect(jours).toContain('2026-03-12')
  })
})

const PLAGE = { du: '2026-03-01', au: '2026-03-31' }

/** Une plage occupant intégralement la journée `jour` (UTC), pour les tests. */
function intervalPourJour(jour: string): BusyInterval {
  const debut = new Date(`${jour}T00:00:00.000Z`).getTime()
  return {
    startIso: new Date(debut).toISOString(),
    endIso: new Date(debut + 86_400_000).toISOString(),
  }
}

function connecteurAvec(jours: string[]): CalendarConnector {
  return {
    dedicatedCalendarId: 'dedie',
    freeBusy: async () => jours.map(intervalPourJour),
  } as unknown as CalendarConnector
}

const connecteurVide = connecteurAvec([])

const connecteurEnPanne = {
  dedicatedCalendarId: 'dedie',
  freeBusy: async () => {
    throw new Error('agenda en panne')
  },
} as unknown as CalendarConnector

const connecteurQuiExplose = {
  dedicatedCalendarId: 'dedie',
  freeBusy: () => {
    throw new Error('boom')
  },
} as unknown as CalendarConnector

const connecteurLent = {
  dedicatedCalendarId: 'dedie',
  freeBusy: () => new Promise<never>(() => {}),
} as unknown as CalendarConnector

const freeBusyEspion = vi.fn(async () => [] as BusyInterval[])
const connecteurEspion = {
  dedicatedCalendarId: 'espion-dedie@group.calendar.google.com',
  freeBusy: freeBusyEspion,
} as unknown as CalendarConnector

describe('getBusyRange', () => {
  // LE test de cette section : l'absence d'occupation et l'echec de lecture
  // rendaient tous deux une liste vide. Indistinguables. Des lors que
  // l'utilisateur CLIQUE pour savoir, une liste vide qui veut dire « Google
  // n'a pas repondu » est un mensonge.
  it('distingue l absence d occupation d un echec de lecture', async () => {
    expect(await getBusyRange('u1', PLAGE, { connector: connecteurVide })).toEqual({
      ok: true,
      jours: [],
    })
    expect(await getBusyRange('u1', PLAGE, { connector: connecteurEnPanne })).toEqual({
      ok: false,
      raison: 'ECHEC',
    })
  })

  it('dit quand aucun connecteur n est configure', async () => {
    expect(await getBusyRange('u1', PLAGE, { connector: null })).toEqual({
      ok: false,
      raison: 'PAS_DE_CONNECTEUR',
    })
  })

  // La garantie de fond ne change pas : la saisie doit fonctionner un jour ou
  // Google est en panne.
  it('ne leve jamais', async () => {
    await expect(getBusyRange('u1', PLAGE, { connector: connecteurQuiExplose })).resolves.toEqual({
      ok: false,
      raison: 'ECHEC',
    })
  })

  it('rend un echec plutot que d attendre un agenda lent', async () => {
    const r = await getBusyRange('u1', PLAGE, { connector: connecteurLent, delaiMs: 5 })

    expect(r).toEqual({ ok: false, raison: 'ECHEC' })
  })

  it('couvre toute la plage demandee, pas seulement son premier mois', async () => {
    const r = await getBusyRange(
      'u1',
      { du: '2026-03-01', au: '2026-05-31' },
      { connector: connecteurAvec(['2026-05-12']) },
    )

    expect(r).toEqual({ ok: true, jours: ['2026-05-12'] })
  })

  it('ecarte le calendrier dedie, comme avant', async () => {
    await getBusyRange('u1', PLAGE, { connector: connecteurEspion })

    expect(freeBusyEspion).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarIds: ['primary', connecteurEspion.dedicatedCalendarId],
      }),
    )
  })

  it('rend les jours tries et sans doublon', async () => {
    const r = await getBusyRange('u1', PLAGE, {
      connector: connecteurAvec(['2026-03-12', '2026-03-04', '2026-03-12']),
    })

    expect(r).toEqual({ ok: true, jours: ['2026-03-04', '2026-03-12'] })
  })
})
