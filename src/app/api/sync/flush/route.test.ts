import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

const { flushAllProviders, flushAllSyncOutboxes } = vi.hoisted(() => ({
  flushAllProviders: vi.fn(),
  flushAllSyncOutboxes: vi.fn(),
}))
vi.mock('@/services/sync/drain', () => ({ flushAllProviders }))
vi.mock('@/services/sync/flush', () => ({ flushAllSyncOutboxes }))

import { POST } from './route'

function requete(authorization?: string): Request {
  return new Request('http://localhost:3000/api/sync/flush', {
    method: 'POST',
    ...(authorization === undefined ? {} : { headers: { authorization } }),
  })
}

let journal: string[]

beforeEach(() => {
  flushAllProviders.mockReset()
  flushAllProviders.mockResolvedValue({ comptes: 1, traitees: 3 })
  flushAllSyncOutboxes.mockReset()
  process.env.SYNC_FLUSH_TOKEN = 'jeton-de-test'
  journal = []
  for (const canal of ['error', 'warn', 'info'] as const) {
    vi.spyOn(console, canal).mockImplementation((...a: unknown[]) => {
      journal.push(a.map(String).join(' '))
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(() => {
  delete process.env.SYNC_FLUSH_TOKEN
})

describe('POST /api/sync/flush', () => {
  it('refuse une requête sans jeton', async () => {
    const res = await POST(requete())
    expect(res.status).toBe(401)
    expect(flushAllProviders).not.toHaveBeenCalled()
  })

  it('refuse un jeton faux', async () => {
    const res = await POST(requete('Bearer mauvais-jeton'))
    expect(res.status).toBe(401)
    expect(flushAllProviders).not.toHaveBeenCalled()
  })

  // Un jeton de la bonne longueur, faux d'un seul octet : la comparaison à
  // durée constante compare bel et bien le contenu, pas seulement la taille.
  it('refuse un jeton de même longueur mais différent', async () => {
    const res = await POST(requete('Bearer jeton-de-tesX'))
    expect(res.status).toBe(401)
    expect(flushAllProviders).not.toHaveBeenCalled()
  })

  it('refuse tout quand aucun jeton n est configuré', async () => {
    // Sans cette garde, un déploiement sans variable ouvrirait l'endpoint.
    delete process.env.SYNC_FLUSH_TOKEN
    const res = await POST(requete('Bearer '))
    expect(res.status).toBe(401)
    expect(flushAllProviders).not.toHaveBeenCalled()
  })

  it('draine et rend le compte rendu avec le bon jeton', async () => {
    const res = await POST(requete('Bearer jeton-de-test'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ comptes: 1, traitees: 3 })
    expect(flushAllProviders).toHaveBeenCalledTimes(1)
    // Tous les fournisseurs, pas le seul agenda : branché sur
    // `flushAllSyncOutboxes`, l'endpoint ne sortait jamais un CRA validé de la
    // file, et rendait pourtant 200 avec un compte rendu d'apparence nominale.
    expect(flushAllSyncOutboxes).not.toHaveBeenCalled()
  })
})

describe('journal du déclenchement externe', () => {
  it('laisse une trace d un refus, sans jamais recopier le jeton', async () => {
    // Un cron mal configuré recevant 401 en boucle est aujourd'hui totalement
    // silencieux : côté serveur, rien ne le distingue d'un cron qui ne tourne
    // pas du tout.
    await POST(requete('Bearer mauvais-jeton'))

    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('sync.flush.api')
    expect(journal[0]).toContain('jeton-refuse')
    expect(journal[0]).not.toContain('mauvais-jeton')
    expect(journal[0]).not.toContain('jeton-de-test')
  })

  it('rend compte du drainage réussi en chiffres', async () => {
    await POST(requete('Bearer jeton-de-test'))

    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('sync.flush.api')
    expect(journal[0]).toContain('traitees=3')
  })

  it('journalise un drainage qui lève, au lieu de le perdre dans un 500', async () => {
    flushAllProviders.mockRejectedValue(new Error('base injoignable'))

    await expect(POST(requete('Bearer jeton-de-test'))).rejects.toThrow('base injoignable')
    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('base injoignable')
  })
})
