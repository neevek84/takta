import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  requireUser,
  revalidatePath,
  flushSyncOutbox,
  resolveConflict,
  retrySyncRow,
  disconnectGoogle,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  flushSyncOutbox: vi.fn(),
  resolveConflict: vi.fn(),
  retrySyncRow: vi.fn(),
  disconnectGoogle: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/sync/flush', () => ({ flushSyncOutbox }))
vi.mock('@/services/sync/conflicts', () => ({ resolveConflict }))
vi.mock('@/services/sync/queue', () => ({ retrySyncRow }))
vi.mock('@/services/google/connect', () => ({ disconnectGoogle }))

import { arbitrer, rejouer, revoquerGoogle, synchroniserMaintenant } from './actions'

const RAPPORT = { nonConnecte: false, traitees: 1, reussies: 1, conflits: 0, echecs: 0 }

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  flushSyncOutbox.mockReset().mockResolvedValue(RAPPORT)
  resolveConflict.mockReset().mockResolvedValue({ ok: true, resolution: 'RETABLIR' })
  retrySyncRow.mockReset().mockResolvedValue(true)
  disconnectGoogle.mockReset().mockResolvedValue(undefined)
})

/**
 * Une action serveur est un point d'entrée public : elle est appelable par
 * quiconque sait former la requête. Sans `requireUser`, « Synchroniser
 * maintenant » pousserait dans l'agenda d'un autre, et « Rejouer » remettrait
 * en file la ligne de n'importe qui — sans qu'aucune page ne le montre.
 */
describe('chaque action exige une session', () => {
  const actions: Array<[string, () => Promise<unknown>]> = [
    ['synchroniserMaintenant', () => synchroniserMaintenant()],
    ['arbitrer', () => arbitrer('c1', 'RETABLIR')],
    ['rejouer', () => rejouer('r1')],
    ['revoquerGoogle', () => revoquerGoogle()],
  ]

  for (const [nom, appeler] of actions) {
    it(`${nom} refuse d agir sans session`, async () => {
      requireUser.mockRejectedValue(new Error('Non authentifié'))

      await expect(appeler()).rejects.toThrow('Non authentifié')

      expect(flushSyncOutbox).not.toHaveBeenCalled()
      expect(resolveConflict).not.toHaveBeenCalled()
      expect(retrySyncRow).not.toHaveBeenCalled()
      expect(disconnectGoogle).not.toHaveBeenCalled()
    })
  }
})

describe('chaque action agit sur le seul compte de la session', () => {
  it('draine la file de la session, et rend le rapport tel quel', async () => {
    expect(await synchroniserMaintenant()).toEqual(RAPPORT)
    expect(flushSyncOutbox).toHaveBeenCalledWith({ userId: 'u1' })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/sync')
  })

  it('arbitre pour la session, et relaie le verdict du service', async () => {
    resolveConflict.mockResolvedValue({ ok: false, reason: 'VERROUILLE', message: 'CRA validé.' })

    expect(await arbitrer('c1', 'ACCEPTER')).toEqual({
      ok: false,
      reason: 'VERROUILLE',
      message: 'CRA validé.',
    })
    expect(resolveConflict).toHaveBeenCalledWith({
      userId: 'u1',
      conflictId: 'c1',
      resolution: 'ACCEPTER',
    })
  })

  it('rejoue une ligne pour la session', async () => {
    expect(await rejouer('r1')).toBe(true)
    expect(retrySyncRow).toHaveBeenCalledWith('u1', 'r1')
  })

  it('révoque la connexion de la session', async () => {
    await revoquerGoogle()
    expect(disconnectGoogle).toHaveBeenCalledWith('u1')
  })
})
