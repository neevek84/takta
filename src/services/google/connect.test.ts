import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { getCredential, saveCredential } from '@/services/credentials'
import { buildConsentUrl, GoogleOAuthError } from '@/integrations/google/oauth'
import { createFakeGoogleApi, type FakeGoogleApi } from '@/integrations/google/fake-google-api'
import { CALENDRIER_DEDIE, connectGoogle, disconnectGoogle, getConnectionState } from './connect'

let userId = ''
let autreId = ''
let api: FakeGoogleApi

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
  process.env.GOOGLE_CLIENT_ID = 'client-id-de-test'
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret-de-test'
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/google/callback'

  const u = await prisma.user.create({
    data: { email: 'connect@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'connect-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id
})

beforeEach(async () => {
  api = createFakeGoogleApi()
  await prisma.providerCredential.deleteMany({})
})

afterAll(async () => {
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['connect@test.local', 'connect-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

describe('URL de consentement', () => {
  it('demande le scope calendrier et un accès hors ligne', () => {
    const url = new URL(buildConsentUrl({ state: 'etat-aleatoire' }))

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar')
    expect(url.searchParams.get('access_type')).toBe('offline')
    // Sans `prompt=consent`, une reconnexion repartirait sans jeton de
    // rafraîchissement — donc sans possibilité de synchroniser en fond.
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  it('porte l état anti-rejeu et l URI de retour', () => {
    const url = new URL(buildConsentUrl({ state: 'etat-aleatoire' }))
    expect(url.searchParams.get('state')).toBe('etat-aleatoire')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/google/callback',
    )
    expect(url.searchParams.get('client_id')).toBe('client-id-de-test')
  })
})

describe('connexion', () => {
  it('stocke les jetons chiffrés et crée le calendrier dédié', async () => {
    const r = await connectGoogle({ userId, code: 'code-de-consentement', fetchFn: api.fetchFn })

    expect(r.calendarId).not.toBe('')
    expect(api.calendars.get(r.calendarId)?.summary).toBe(CALENDRIER_DEDIE)

    const creds = await getCredential(userId, 'GOOGLE')
    expect(creds?.accessToken).toBe('ya29.nouveau')
    expect(creds?.refreshToken).toBe('1//rafraichissement')
    expect(creds?.calendarId).toBe(r.calendarId)

    const row = await prisma.providerCredential.findFirstOrThrow({ where: { userId } })
    expect(row.refreshTokenEnc).not.toContain('rafraichissement')
  })

  it('réutilise le calendrier dédié à la reconnexion', async () => {
    const premier = await connectGoogle({ userId, code: 'code-1', fetchFn: api.fetchFn })
    const second = await connectGoogle({ userId, code: 'code-2', fetchFn: api.fetchFn })

    expect(second.calendarId).toBe(premier.calendarId)
    expect(api.calendars.size).toBe(1)
    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(1)
  })

  it('ne stocke rien quand Google refuse le code', async () => {
    api.oauth.refusRefresh = true

    await expect(
      connectGoogle({ userId, code: 'code-invalide', fetchFn: api.fetchFn }),
    ).rejects.toThrow()
    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(0)
  })

  it('refuse un consentement qui ne rapporte pas de jeton de rafraîchissement', async () => {
    // Google omet ce jeton quand le compte a déjà consenti sans que
    // `prompt=consent` le redemande. Accepter l'échange rendrait la connexion
    // « réussie » puis morte une heure plus tard, sans explication possible.
    const fetchFn: typeof api.fetchFn = async (url, init) => {
      const reponse = await api.fetchFn(url, init)
      if (!url.startsWith('https://oauth2.googleapis.com/token')) return reponse

      const corps = (await reponse.json()) as Record<string, unknown>
      delete corps.refresh_token
      return new Response(JSON.stringify(corps), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    await expect(connectGoogle({ userId, code: 'code', fetchFn })).rejects.toThrow(GoogleOAuthError)
    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(0)
  })

  it('ne laisse pas une connexion à moitié faite quand le calendrier échoue', async () => {
    // Le jeton est obtenu, la création du calendrier échoue : sans annulation,
    // l'écran afficherait « connecté » pour un compte inutilisable.
    let appels = 0
    const fetchFn: typeof api.fetchFn = async (url, init) => {
      appels += 1
      if (appels > 1) api.failNext('SERVEUR')
      return api.fetchFn(url, init)
    }

    await expect(connectGoogle({ userId, code: 'code', fetchFn })).rejects.toThrow()
    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(0)
  })

  it('journalise l annulation, qui efface sa propre trace en base', async () => {
    // L'annulation est correcte, mais elle ne laisse rien derrière elle : sans
    // cette ligne, un compte qui n'arrive jamais à se connecter ne produit
    // aucune trace du tout, ni en base ni ailleurs.
    const journal: string[] = []
    const espion = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      journal.push(a.map(String).join(' '))
    })

    let appels = 0
    const fetchFn: typeof api.fetchFn = async (url, init) => {
      appels += 1
      if (appels > 1) api.failNext('SERVEUR')
      return api.fetchFn(url, init)
    }

    await expect(connectGoogle({ userId, code: 'code', fetchFn })).rejects.toThrow()

    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('google.connexion')
    expect(journal[0]).toContain(`userId=${userId}`)
    // Le jeton d'accès fraîchement obtenu ne doit jamais atteindre la sortie.
    const jeton = (await prisma.providerCredential.findFirst({ where: { userId } })) ?? null
    expect(jeton).toBeNull()
    espion.mockRestore()
  })
})

describe('état et révocation', () => {
  it('rend l état non connecté par défaut', async () => {
    expect(await getConnectionState(userId)).toEqual({
      connected: false,
      calendarId: '',
      scope: '',
      connectedAt: null,
    })
  })

  it('rend l état connecté après consentement', async () => {
    const r = await connectGoogle({ userId, code: 'code', fetchFn: api.fetchFn })
    const etat = await getConnectionState(userId)

    expect(etat.connected).toBe(true)
    expect(etat.calendarId).toBe(r.calendarId)
    expect(etat.scope).toContain('calendar')
    expect(etat.connectedAt).toBeInstanceOf(Date)
  })

  it('ne dit pas « connecté » pour des jetons sans calendrier dédié', async () => {
    // Même invariant que `resolveConnector`, qui rend `null` sans calendrier :
    // l'écran annoncerait une synchronisation qui ne partirait jamais.
    await saveCredential(userId, 'GOOGLE', {
      accessToken: 'ya29.acces',
      refreshToken: '1//rafraichissement',
      expiresAt: new Date(Date.now() + 3_600_000),
      scope: 'https://www.googleapis.com/auth/calendar',
      calendarId: '',
    })

    expect((await getConnectionState(userId)).connected).toBe(false)
  })

  it('révoque la connexion', async () => {
    await connectGoogle({ userId, code: 'code', fetchFn: api.fetchFn })
    await disconnectGoogle(userId)

    expect((await getConnectionState(userId)).connected).toBe(false)
    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(0)
  })

  it('ne mélange pas les connexions de deux utilisateurs', async () => {
    await connectGoogle({ userId, code: 'code', fetchFn: api.fetchFn })
    expect((await getConnectionState(autreId)).connected).toBe(false)

    await disconnectGoogle(autreId)
    expect((await getConnectionState(userId)).connected).toBe(true)
  })
})
