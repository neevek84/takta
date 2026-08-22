import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireUser, revalidatePath, definirRole, definirActivation } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  definirRole: vi.fn(),
  definirActivation: vi.fn(),
}))

vi.mock('@/auth', () => ({
  requireUser,
  // Les gardes de rôle s'appuient sur la même session, et **appliquent la vraie
  // règle** : `peutAdministrer` est importée, pas recopiée. Un double qui
  // laisserait passer un consultant ferait passer au vert une action sans
  // garde.
  exigerAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer, MOTIF_REFUS_ADMIN } = await import('@/core/auth/roles')
    if (!peutAdministrer(u.role)) throw new Error(MOTIF_REFUS_ADMIN)
    return u
  },
}))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/auth/comptes', () => ({ definirRole, definirActivation }))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { changerActivation, changerRole } from './actions'

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'patron', role: 'ADMIN' })
  revalidatePath.mockReset()
  definirRole.mockReset().mockResolvedValue({ ok: true, motif: '' })
  definirActivation.mockReset().mockResolvedValue({ ok: true, motif: '' })
})

describe('les actions des comptes exigent le rôle, pas seulement la session', () => {
  // Une action serveur est un point d'entrée HTTP à part entière : elle est
  // atteignable sans jamais avoir affiché l'écran qui la déclare. Sans garde
  // ici, n'importe quel compte connecté s'élève lui-même au rôle
  // d'administrateur — le contrôle structurel de `src/admin-garde.test.ts` ne
  // lit que la forme, et sa fenêtre de lecture peut attraper la garde de la
  // fonction voisine.
  it('refuse un consultant qui change un rôle, sans rien écrire', async () => {
    requireUser.mockResolvedValue({ id: 'u2', role: 'CONSULTANT' })

    await expect(changerRole('cible', 'ADMIN')).rejects.toThrow(/administrateurs/)
    expect(definirRole).not.toHaveBeenCalled()
  })

  it('refuse un consultant qui coupe un accès, sans rien écrire', async () => {
    requireUser.mockResolvedValue({ id: 'u2', role: 'CONSULTANT' })

    await expect(changerActivation('cible', false)).rejects.toThrow(/administrateurs/)
    expect(definirActivation).not.toHaveBeenCalled()
  })
})

describe('changerRole', () => {
  // Le `parId` vient de la **session**, jamais de l'appelant : c'est lui qui
  // porte les deux règles anti-murage, et un identifiant fourni par le client
  // permettrait à un administrateur de se retirer son propre rôle en se faisant
  // passer pour un autre.
  it('nomme le demandeur d après la session, pas d après ses arguments', async () => {
    await changerRole('cible', 'MANAGER')

    expect(definirRole).toHaveBeenCalledWith({
      userId: 'cible',
      role: 'MANAGER',
      parId: 'patron',
    })
  })

  it('remonte le motif du refus du service', async () => {
    definirRole.mockResolvedValue({ ok: false, motif: 'Ce compte est le dernier administrateur.' })

    const etat = await changerRole('cible', 'CONSULTANT')

    expect(etat).toEqual({ ok: false, message: 'Ce compte est le dernier administrateur.' })
  })
})

describe('changerActivation', () => {
  // Le message est la seule chose qui distingue « couper » de « supprimer » aux
  // yeux de qui clique : sans lui, le geste a l'air destructeur et personne ne
  // l'emploie.
  it('dit que couper un accès ne supprime rien', async () => {
    const etat = await changerActivation('cible', false)

    expect(etat?.ok).toBe(true)
    expect(etat?.message).toMatch(/rien n’a été supprimé/i)
  })

  it('rouvre un accès, et le dit', async () => {
    const etat = await changerActivation('cible', true)

    expect(definirActivation).toHaveBeenCalledWith({
      userId: 'cible',
      actif: true,
      parId: 'patron',
    })
    expect(etat).toEqual({ ok: true, message: 'Accès rouvert.' })
  })
})
