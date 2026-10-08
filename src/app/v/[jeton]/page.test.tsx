// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const { resoudreLien, lireVueClient, lienDeLaSession, origineDocumensoEnVigueur } = vi.hoisted(() => ({
  resoudreLien: vi.fn(),
  lireVueClient: vi.fn(),
  lienDeLaSession: vi.fn(),
  origineDocumensoEnVigueur: vi.fn(),
}))

vi.mock('@/services/signature/lien-client', () => ({ resoudreLien, lireVueClient }))
vi.mock('@/services/signature/reglages', () => ({ origineDocumensoEnVigueur }))
vi.mock('./session', () => ({ lienDeLaSession }))
vi.mock('./actions', () => ({ confirmerSignature: vi.fn(), renouvelerSignature: vi.fn() }))
// Ce test porte sur la politique de la page, pas sur ses composants.
vi.mock('@/components/client/CraLecture', () => ({ CraLecture: () => <div /> }))
vi.mock('@/components/client/CadreSignature', () => ({ CadreSignature: () => <div /> }))
vi.mock('@/components/client/FormulaireCode', () => ({ FormulaireCode: () => <div /> }))

import PageClient from './page'

const JETON = 'a'.repeat(64)

async function rendre() {
  render(
    await PageClient({
      params: Promise.resolve({ jeton: JETON }),
      searchParams: Promise.resolve({}),
    }),
  )
}

/** Les politiques posées par la page, où que React les ait placées. */
function politiques(): string[] {
  return Array.from(document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')).map(
    (m) => m.getAttribute('content') ?? '',
  )
}

beforeEach(() => {
  resoudreLien.mockReset().mockResolvedValue({ etat: 'ACTIF', lienId: 'l1' })
  lienDeLaSession.mockReset().mockResolvedValue(null)
  lireVueClient.mockReset()
  origineDocumensoEnVigueur.mockReset().mockResolvedValue('https://sign.exemple.test')
})
afterEach(() => {
  cleanup()
  document.head.innerHTML = ''
})

describe('page client — la politique des cadres', () => {
  it('limite les cadres à l instance Documenso en vigueur', async () => {
    await rendre()
    expect(politiques()).toEqual(['frame-src https://sign.exemple.test'])
  })

  it('n autorise aucun cadre sans instance configurée', async () => {
    origineDocumensoEnVigueur.mockResolvedValue('')
    await rendre()
    expect(politiques()).toEqual(["frame-src 'none'"])
  })

  it('pose la politique aussi sur les pages neutres', async () => {
    resoudreLien.mockResolvedValue({ etat: 'INCONNU', lienId: null })
    await rendre()
    expect(politiques()).toEqual(['frame-src https://sign.exemple.test'])
  })
})
