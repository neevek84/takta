import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/db/client'
import { verifyPassword } from '@/auth-password'
import { empreinteJeton } from '@/core/auth/reinitialisation'

const { notify } = vi.hoisted(() => ({ notify: vi.fn() }))
vi.mock('@/services/notify', () => ({ notify }))

import { definirMotDePasse, demanderReinitialisation } from './mot-de-passe'

const MAINTENANT = new Date('2026-08-22T10:00:00.000Z')
let userId = ''

beforeEach(async () => {
  notify.mockReset().mockResolvedValue({ envoye: true, motif: '' })
  await prisma.user.deleteMany({ where: { email: { startsWith: 'mdp-' } } })
  const u = await prisma.user.create({
    data: { email: 'mdp-cible@test.local', name: 'C', passwordHash: '', role: 'CONSULTANT' },
  })
  userId = u.id
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'mdp-' } } })
  await prisma.$disconnect()
})

/** Le jeton tel qu'il est parti dans le courriel. */
function jetonEnvoye(): string {
  const corps = String(notify.mock.calls[0]![0].corps)
  return /jeton=([0-9a-f]{64})/.exec(corps)![1]!
}

describe('demanderReinitialisation', () => {
  it('envoie un lien et ne garde que son empreinte', async () => {
    await demanderReinitialisation({
      email: 'mdp-cible@test.local',
      origine: 'https://cra.test',
      maintenant: MAINTENANT,
    })

    const jeton = jetonEnvoye()
    const ligne = await prisma.passwordReset.findFirstOrThrow({ where: { userId } })
    expect(ligne.tokenHash).toBe(empreinteJeton(jeton))
    // La base ne porte nulle part le jeton lui-même.
    expect(JSON.stringify(ligne)).not.toContain(jeton)
    expect(ligne.expiresAt.toISOString()).toBe('2026-08-22T10:10:00.000Z')
  })

  // Sans cette précaution, le formulaire devient un annuaire : on y teste des
  // adresses jusqu'à savoir qui travaille ici.
  it("n'envoie rien pour une adresse inconnue, et ne lève pas", async () => {
    await expect(
      demanderReinitialisation({ email: 'inconnu@test.local', origine: 'https://cra.test' }),
    ).resolves.toBeUndefined()
    expect(notify).not.toHaveBeenCalled()
  })

  it('adresse le courriel au compte visé, pas au destinataire des notifications', async () => {
    await demanderReinitialisation({ email: 'mdp-cible@test.local', origine: 'https://cra.test' })
    expect(notify.mock.calls[0]![1]).toEqual({ destinataire: 'mdp-cible@test.local' })
  })
})

describe('definirMotDePasse', () => {
  async function unLien(): Promise<string> {
    await demanderReinitialisation({
      email: 'mdp-cible@test.local',
      origine: 'https://cra.test',
      maintenant: MAINTENANT,
    })
    return jetonEnvoye()
  }

  it('pose le mot de passe et marque le lien consommé', async () => {
    const jeton = await unLien()

    const r = await definirMotDePasse({ jeton, motDePasse: 'un-bon-secret', maintenant: MAINTENANT })

    expect(r.ok).toBe(true)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(await verifyPassword(user.passwordHash, 'un-bon-secret')).toBe(true)
    const ligne = await prisma.passwordReset.findFirstOrThrow({ where: { userId } })
    expect(ligne.usedAt).not.toBeNull()
  })

  it('refuse un lien déjà consommé', async () => {
    const jeton = await unLien()
    await definirMotDePasse({ jeton, motDePasse: 'premier-secret', maintenant: MAINTENANT })

    const r = await definirMotDePasse({ jeton, motDePasse: 'second-secret', maintenant: MAINTENANT })

    expect(r.ok).toBe(false)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
    expect(await verifyPassword(user.passwordHash, 'second-secret')).toBe(false)
  })

  it('refuse un lien expiré', async () => {
    const jeton = await unLien()

    const r = await definirMotDePasse({
      jeton,
      motDePasse: 'trop-tard',
      maintenant: new Date('2026-08-22T10:10:00.000Z'),
    })

    expect(r.ok).toBe(false)
  })

  it('refuse un jeton inventé', async () => {
    const r = await definirMotDePasse({ jeton: 'f'.repeat(64), motDePasse: 'x-secret' })
    expect(r.ok).toBe(false)
  })

  // Deux demandes de suite, puis une consommation : la première ne doit pas
  // rester ouverte derrière.
  it('annule les autres liens en attente du même compte', async () => {
    await unLien()
    const second = await unLien()

    await definirMotDePasse({ jeton: second, motDePasse: 'un-bon-secret', maintenant: MAINTENANT })

    const restants = await prisma.passwordReset.count({ where: { userId, usedAt: null } })
    expect(restants).toBe(0)
  })
})
