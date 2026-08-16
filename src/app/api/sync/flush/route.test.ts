import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

const { flushAllSyncOutboxes } = vi.hoisted(() => ({ flushAllSyncOutboxes: vi.fn() }))
vi.mock('@/services/sync/flush', () => ({ flushAllSyncOutboxes }))

import { POST } from './route'

function requete(authorization?: string): Request {
  return new Request('http://localhost:3000/api/sync/flush', {
    method: 'POST',
    ...(authorization === undefined ? {} : { headers: { authorization } }),
  })
}

beforeEach(() => {
  flushAllSyncOutboxes.mockReset()
  flushAllSyncOutboxes.mockResolvedValue({ comptes: 1, traitees: 3 })
  process.env.SYNC_FLUSH_TOKEN = 'jeton-de-test'
})

afterAll(() => {
  delete process.env.SYNC_FLUSH_TOKEN
})

describe('POST /api/sync/flush', () => {
  it('refuse une requête sans jeton', async () => {
    const res = await POST(requete())
    expect(res.status).toBe(401)
    expect(flushAllSyncOutboxes).not.toHaveBeenCalled()
  })

  it('refuse un jeton faux', async () => {
    const res = await POST(requete('Bearer mauvais-jeton'))
    expect(res.status).toBe(401)
    expect(flushAllSyncOutboxes).not.toHaveBeenCalled()
  })

  // Un jeton de la bonne longueur, faux d'un seul octet : la comparaison à
  // durée constante compare bel et bien le contenu, pas seulement la taille.
  it('refuse un jeton de même longueur mais différent', async () => {
    const res = await POST(requete('Bearer jeton-de-tesX'))
    expect(res.status).toBe(401)
    expect(flushAllSyncOutboxes).not.toHaveBeenCalled()
  })

  it('refuse tout quand aucun jeton n est configuré', async () => {
    // Sans cette garde, un déploiement sans variable ouvrirait l'endpoint.
    delete process.env.SYNC_FLUSH_TOKEN
    const res = await POST(requete('Bearer '))
    expect(res.status).toBe(401)
    expect(flushAllSyncOutboxes).not.toHaveBeenCalled()
  })

  it('draine et rend le compte rendu avec le bon jeton', async () => {
    const res = await POST(requete('Bearer jeton-de-test'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ comptes: 1, traitees: 3 })
    expect(flushAllSyncOutboxes).toHaveBeenCalledTimes(1)
  })
})
