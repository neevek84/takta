import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  demanderCode: vi.fn(),
  verifierCode: vi.fn(),
  confirmerDepuisPage: vi.fn(),
  renouvelerDepuisPage: vi.fn(),
  ouvrirSession: vi.fn(),
  lienDeLaSession: vi.fn(),
  autoriser: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`)
  }),
}))
vi.mock('@/services/signature/lien-client', () => ({
  demanderCode: m.demanderCode, verifierCode: m.verifierCode,
  confirmerDepuisPage: m.confirmerDepuisPage, renouvelerDepuisPage: m.renouvelerDepuisPage,
}))
vi.mock('@/services/signature/limiteur', () => ({ autoriser: m.autoriser }))
vi.mock('./session', () => ({ ouvrirSession: m.ouvrirSession, lienDeLaSession: m.lienDeLaSession }))
vi.mock('next/headers', () => ({ headers: m.headers }))
vi.mock('next/navigation', () => ({ redirect: m.redirect }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { confirmerSignature, demanderCodeAction, validerCodeAction } from './actions'

const J = 'a'.repeat(64)
const fd = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset?.()
  m.redirect.mockImplementation((url: string) => {
    throw new Error(`REDIRECT ${url}`)
  })
  m.headers.mockResolvedValue({ get: (n: string) => (n === 'x-forwarded-for' ? '1.2.3.4, 10.0.0.1' : null) })
  m.autoriser.mockReturnValue(true)
})

describe('page client — actions', () => {
  it('demander un code renvoie vers la saisie', async () => {
    m.demanderCode.mockResolvedValue({ ok: true, adresseMasquee: 'j•••@c.fr' })
    await expect(demanderCodeAction(fd({ jeton: J }))).rejects.toThrow(`REDIRECT /v/${J}?etape=code`)
  })

  it('un code juste ouvre la session puis recharge la page', async () => {
    m.verifierCode.mockResolvedValue({ ok: true, lienId: 'l1' })
    await expect(validerCodeAction(fd({ jeton: J, code: '123456' }))).rejects.toThrow(`REDIRECT /v/${J}`)
    expect(m.ouvrirSession).toHaveBeenCalledWith(J, 'l1')
  })

  it('un code faux ne pose aucune session', async () => {
    m.verifierCode.mockResolvedValue({ ok: false, raison: 'CODE' })
    await expect(validerCodeAction(fd({ jeton: J, code: '000000' }))).rejects.toThrow(`erreur=CODE`)
    expect(m.ouvrirSession).not.toHaveBeenCalled()
  })

  it('la limite par IP s applique avant toute vérification, sur la première adresse de la chaîne', async () => {
    m.autoriser.mockReturnValue(false)
    await expect(validerCodeAction(fd({ jeton: J, code: '123456' }))).rejects.toThrow('erreur=LIMITE')
    expect(m.autoriser).toHaveBeenCalledWith('1.2.3.4')
    expect(m.verifierCode).not.toHaveBeenCalled()
  })

  it('confirmer sans session ne fait rien', async () => {
    m.lienDeLaSession.mockResolvedValue(null)
    await confirmerSignature(J)
    expect(m.confirmerDepuisPage).not.toHaveBeenCalled()
  })

  it('confirmer avec session relit chez le prestataire', async () => {
    m.lienDeLaSession.mockResolvedValue('l1')
    await confirmerSignature(J)
    expect(m.confirmerDepuisPage).toHaveBeenCalledWith('l1')
  })
})
