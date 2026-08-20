import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  requireUser,
  revalidatePath,
  drainProvidersForUser,
  drainSyncOutbox,
  resolveConflict,
  retrySyncRow,
  disconnectGoogle,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  drainProvidersForUser: vi.fn(),
  drainSyncOutbox: vi.fn(),
  resolveConflict: vi.fn(),
  retrySyncRow: vi.fn(),
  disconnectGoogle: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/sync/drain', () => ({ drainProvidersForUser }))
vi.mock('@/services/sync/flush', () => ({ drainSyncOutbox }))
vi.mock('@/services/sync/conflicts', () => ({ resolveConflict }))
vi.mock('@/services/sync/queue', () => ({ retrySyncRow }))
vi.mock('@/services/google/connect', () => ({ disconnectGoogle }))

import { arbitrer, deconnecterGoogle, rejouer, synchroniserMaintenant } from './actions'

const RAPPORT = { nonConnecte: false, traitees: 1, reussies: 1, conflits: 0, echecs: 0, reste: 0 }

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  drainProvidersForUser.mockReset().mockResolvedValue(RAPPORT)
  drainSyncOutbox.mockReset().mockResolvedValue(RAPPORT)
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
    ['deconnecterGoogle', () => deconnecterGoogle()],
  ]

  for (const [nom, appeler] of actions) {
    it(`${nom} refuse d agir sans session`, async () => {
      requireUser.mockRejectedValue(new Error('Non authentifié'))

      await expect(appeler()).rejects.toThrow('Non authentifié')

      expect(drainProvidersForUser).not.toHaveBeenCalled()
      expect(drainSyncOutbox).not.toHaveBeenCalled()
      expect(resolveConflict).not.toHaveBeenCalled()
      expect(retrySyncRow).not.toHaveBeenCalled()
      expect(disconnectGoogle).not.toHaveBeenCalled()
    })
  }
})

describe('chaque action agit sur le seul compte de la session', () => {
  /**
   * `drainProvidersForUser` et non `drainSyncOutbox` : ce bouton draine **tous**
   * les fournisseurs. Branché sur le seul drainage de l'agenda, il laissait un
   * CRA validé s'empiler pour toujours dans la file Dolibarr — sans erreur,
   * sans message, et sans que l'écran ne montre quoi que ce soit.
   *
   * Et un drainage, pas une passe : une seule passe s'arrêterait au lot en
   * rendant un compte rendu indiscernable d'une file vidée.
   */
  it('draine tous les fournisseurs de la session, et rend le rapport tel quel', async () => {
    expect(await synchroniserMaintenant()).toEqual(RAPPORT)
    expect(drainProvidersForUser).toHaveBeenCalledWith({ userId: 'u1' })
    // Le drainage de l'agenda n'est plus appelé d'ici : il l'est par
    // `drainProvidersForUser`, avec celui des gestionnaires.
    expect(drainSyncOutbox).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/admin/sync')
  })

  it('relaie le reste annoncé par le drainage', async () => {
    drainProvidersForUser.mockResolvedValue({ ...RAPPORT, traitees: 1000, reste: 42 })
    expect(await synchroniserMaintenant()).toMatchObject({ reste: 42 })
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

  it('rejoue une ligne sans la filtrer sur son propriétaire', async () => {
    // La file est de portée instance : un CRA appartient à une mission, pas à
    // celui qui a créé la ligne. La session reste exigée — c'est le seul
    // garde-fou tant que les rôles n'existent pas.
    expect(await rejouer('r1')).toBe(true)
    expect(retrySyncRow).toHaveBeenCalledWith('r1')
  })

  it('déconnecte le compte Google de la session', async () => {
    await deconnecterGoogle()
    expect(disconnectGoogle).toHaveBeenCalledWith('u1')
  })
})
