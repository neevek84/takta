import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SecretBoxError } from '@/core/crypto/secret-box'

const { getCredential, updateAccessToken, refreshAccessToken, createGoogleCalendarConnector } =
  vi.hoisted(() => ({
    getCredential: vi.fn(),
    updateAccessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
    createGoogleCalendarConnector: vi.fn(),
  }))

vi.mock('@/services/credentials', () => ({ getCredential, updateAccessToken }))
vi.mock('@/integrations/google/oauth', () => ({ refreshAccessToken }))
vi.mock('@/integrations/google/calendar', () => ({ createGoogleCalendarConnector }))

import { resolveConnector } from './connector'

const MAINTENANT = new Date('2026-03-10T09:00:00Z')

function jetons(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'jeton-acces',
    refreshToken: 'jeton-rafraichissement',
    expiresAt: new Date('2026-03-10T10:00:00Z'),
    scope: 'https://www.googleapis.com/auth/calendar',
    calendarId: 'cal-dedie',
    ...overrides,
  }
}

let journal: string[]

beforeEach(() => {
  getCredential.mockReset().mockResolvedValue(jetons())
  updateAccessToken.mockReset().mockResolvedValue(undefined)
  refreshAccessToken.mockReset()
  createGoogleCalendarConnector.mockReset().mockReturnValue({ marqueur: 'connecteur' })
  journal = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    journal.push(a.map(String).join(' '))
  })
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    journal.push(a.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('le chemin nominal reste silencieux', () => {
  it('rend un connecteur sans rien journaliser', async () => {
    const c = await resolveConnector('u1', { now: MAINTENANT })

    expect(c).not.toBeNull()
    expect(journal).toEqual([])
  })

  it('ne journalise rien pour un compte simplement pas connecté', async () => {
    // Ce n'est pas une panne : c'est l'état par défaut de toute installation.
    getCredential.mockResolvedValue(null)

    expect(await resolveConnector('u1', { now: MAINTENANT })).toBeNull()
    expect(journal).toEqual([])
  })
})

describe('chaque cause de « null » devient distinguable', () => {
  it('journalise la lecture des jetons qui échoue', async () => {
    getCredential.mockRejectedValue(new SecretBoxError('CREDENTIALS_KEY est absente.'))

    expect(await resolveConnector('u1', { now: MAINTENANT })).toBeNull()
    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('sync.connecteur')
    expect(journal[0]).toContain('userId=u1')
    expect(journal[0]).toContain('CREDENTIALS_KEY')
  })

  it('journalise un compte connecté sans calendrier dédié', async () => {
    // Demi-état : les jetons sont là, l'agenda non. Rien ne partira jamais,
    // et l'écran dit « non connecté ».
    getCredential.mockResolvedValue(jetons({ calendarId: '' }))

    expect(await resolveConnector('u1', { now: MAINTENANT })).toBeNull()
    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('sync.connecteur')
    expect(journal[0]).toContain('calendrier-absent')
  })

  it('journalise un rafraîchissement refusé par Google', async () => {
    getCredential.mockResolvedValue(jetons({ expiresAt: new Date('2026-03-10T09:00:10Z') }))
    refreshAccessToken.mockRejectedValue(new Error('Google a refusé la demande de jeton (HTTP 400).'))

    expect(await resolveConnector('u1', { now: MAINTENANT })).toBeNull()
    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('sync.connecteur')
    expect(journal[0]).toContain('HTTP 400')
  })

  it('ne laisse jamais un jeton atteindre le journal', async () => {
    getCredential.mockResolvedValue(jetons({ expiresAt: new Date('2026-03-10T09:00:10Z') }))
    refreshAccessToken.mockRejectedValue(
      new Error('refus du refresh_token=1//05aBcDeFgHiJkLmNoPqRs'),
    )

    await resolveConnector('u1', { now: MAINTENANT })

    expect(journal[0]).not.toContain('1//05aBcDeFgHiJkLmNoPqRs')
    expect(journal[0]).not.toContain('jeton-rafraichissement')
  })
})
