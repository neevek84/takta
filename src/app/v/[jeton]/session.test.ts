import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => ({
  resoudreLien: vi.fn(),
  cookies: vi.fn(),
}))
vi.mock('@/services/signature/lien-client', () => ({
  resoudreLien: m.resoudreLien,
  secretClient: () => 'secret-de-test',
}))
vi.mock('next/headers', () => ({ cookies: m.cookies }))

import { signerSessionClient } from '@/core/signature/code-client'
import { COOKIE_CLIENT, lienDeLaSession, ouvrirSession } from './session'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)

/** Un magasin de cookies minimal, tel que `next/headers` le rend. */
function magasin(valeur?: string) {
  const set = vi.fn()
  m.cookies.mockResolvedValue({ get: (n: string) => (n === COOKIE_CLIENT && valeur !== undefined ? { value: valeur } : undefined), set })
  return set
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T10:00:00Z'))
  m.resoudreLien.mockImplementation(async (jeton: string) =>
    jeton === A ? { etat: 'ACTIF', lienId: 'lienA' }
    : jeton === B ? { etat: 'ACTIF', lienId: 'lienB' }
    : { etat: 'INCONNU', lienId: null },
  )
})
afterEach(() => vi.useRealTimers())

const valide = (lienId: string, minutes = 60) =>
  signerSessionClient(lienId, new Date(Date.now() + minutes * 60_000), 'secret-de-test')

describe('session client', () => {
  it('une session valide ouvre son propre lien', async () => {
    magasin(valide('lienA'))
    expect(await lienDeLaSession(A)).toBe('lienA')
  })

  it('une session ouverte sur le lien A ne vaut rien pour le jeton B', async () => {
    magasin(valide('lienA'))
    expect(await lienDeLaSession(B)).toBeNull()
  })

  it('un cookie expiré ne vaut rien', async () => {
    magasin(valide('lienA', -1))
    expect(await lienDeLaSession(A)).toBeNull()
  })

  it('un cookie falsifié ne vaut rien', async () => {
    const v = valide('lienA')
    magasin(v.slice(0, -2) + (v.endsWith('aa') ? 'bb' : 'aa'))
    expect(await lienDeLaSession(A)).toBeNull()
    magasin('n-importe-quoi')
    expect(await lienDeLaSession(A)).toBeNull()
  })

  it('un cookie signé avec un autre secret ne vaut rien', async () => {
    magasin(signerSessionClient('lienA', new Date(Date.now() + 60_000), 'autre-secret'))
    expect(await lienDeLaSession(A)).toBeNull()
  })

  it('un jeton inconnu ne vaut rien, cookie ou pas', async () => {
    magasin(valide('lienA'))
    expect(await lienDeLaSession('0'.repeat(64))).toBeNull()
  })

  it('sans cookie : null', async () => {
    magasin(undefined)
    expect(await lienDeLaSession(A)).toBeNull()
  })

  it('ouvrirSession pose un cookie httpOnly, lax, limité au chemin du lien, pour deux heures', async () => {
    const set = magasin()
    await ouvrirSession(A, 'lienA')
    expect(set).toHaveBeenCalledTimes(1)
    const [nom, valeur, options] = set.mock.calls[0]!
    expect(nom).toBe(COOKIE_CLIENT)
    expect(typeof valeur).toBe('string')
    expect(options.httpOnly).toBe(true)
    expect(options.sameSite).toBe('lax')
    expect(options.path).toBe(`/v/${A}`)
    expect((options.expires as Date).getTime()).toBe(Date.now() + 120 * 60_000)
    // Le cookie posé rouvre bien ce lien.
    magasin(valeur)
    expect(await lienDeLaSession(A)).toBe('lienA')
  })
})
