import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from './client'

let userId = ''
let autreId = ''

const CIBLE = { entityType: 'TimeEntry', entityId: 'entry-1', provider: 'GOOGLE' }

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'sync-schema@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'sync-schema-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id
})

beforeEach(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.externalLink.deleteMany({})
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['sync-schema@test.local', 'sync-schema-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

describe('SyncOutbox — un ensemble, pas un journal', () => {
  // Le test central du lot : c'est l'unicité du triplet qui rend la
  // synchronisation idempotente par construction, et le rejeu gratuit.
  it('dix mises en file de la même entité ne produisent qu une ligne', async () => {
    for (let i = 0; i < 10; i++) {
      await prisma.syncOutbox.upsert({
        where: { entityType_entityId_provider: CIBLE },
        create: { ...CIBLE, userId, operation: 'UPSERT' },
        update: { operation: 'UPSERT', state: 'PENDING', attempts: 0, lastError: '' },
      })
    }

    expect(await prisma.syncOutbox.count()).toBe(1)
  })

  it('refuse un doublon inséré sans passer par l upsert', async () => {
    await prisma.syncOutbox.create({ data: { ...CIBLE, userId, operation: 'UPSERT' } })
    await expect(
      prisma.syncOutbox.create({ data: { ...CIBLE, userId, operation: 'DELETE' } }),
    ).rejects.toThrow()
  })

  it('sépare deux entités distinctes', async () => {
    await prisma.syncOutbox.create({ data: { ...CIBLE, userId, operation: 'UPSERT' } })
    await prisma.syncOutbox.create({
      data: { ...CIBLE, entityId: 'entry-2', userId, operation: 'UPSERT' },
    })
    expect(await prisma.syncOutbox.count()).toBe(2)
  })

  it('sépare deux fournisseurs pour la même entité', async () => {
    await prisma.syncOutbox.create({ data: { ...CIBLE, userId, operation: 'UPSERT' } })
    await prisma.syncOutbox.create({
      data: { ...CIBLE, provider: 'DOLIBARR', userId, operation: 'UPSERT' },
    })
    expect(await prisma.syncOutbox.count()).toBe(2)
  })

  it('naît PENDING, sans tentative et sans erreur', async () => {
    const row = await prisma.syncOutbox.create({ data: { ...CIBLE, userId, operation: 'UPSERT' } })
    expect({ state: row.state, attempts: row.attempts, lastError: row.lastError }).toEqual({
      state: 'PENDING',
      attempts: 0,
      lastError: '',
    })
  })

  it('disparaît avec son utilisateur', async () => {
    await prisma.syncOutbox.create({ data: { ...CIBLE, userId: autreId, operation: 'UPSERT' } })
    await prisma.user.delete({ where: { id: autreId } })
    expect(await prisma.syncOutbox.count()).toBe(0)

    const a = await prisma.user.create({
      data: { email: 'sync-schema-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    autreId = a.id
  })
})

describe('SyncConflict', () => {
  it('naît non résolu, sans arbitrage', async () => {
    const c = await prisma.syncConflict.create({
      data: { ...CIBLE, userId, kind: 'REMOTE_MODIFIED', remoteSnapshotJson: '{"etag":"2"}' },
    })
    expect(c.resolvedAt).toBeNull()
    expect(c.resolution).toBe('')
  })

  it('accepte plusieurs divergences successives sur la même entité', async () => {
    await prisma.syncConflict.create({
      data: { ...CIBLE, userId, kind: 'REMOTE_MODIFIED', resolvedAt: new Date(), resolution: 'DETACHER' },
    })
    await prisma.syncConflict.create({ data: { ...CIBLE, userId, kind: 'REMOTE_DELETED' } })

    expect(await prisma.syncConflict.count({ where: { resolvedAt: null } })).toBe(1)
  })
})

describe('ProviderCredential', () => {
  it('est unique par utilisateur et fournisseur', async () => {
    const base = {
      provider: 'GOOGLE',
      accessTokenEnc: 'v1.a.b.c',
      refreshTokenEnc: 'v1.d.e.f',
      expiresAt: new Date('2026-08-15T12:00:00Z'),
    }
    await prisma.providerCredential.create({ data: { ...base, userId } })
    await expect(prisma.providerCredential.create({ data: { ...base, userId } })).rejects.toThrow()

    // Le même fournisseur chez un autre utilisateur reste possible.
    await prisma.providerCredential.create({ data: { ...base, userId: autreId } })
    expect(await prisma.providerCredential.count()).toBe(2)
  })

  it('naît sans calendrier dédié', async () => {
    const c = await prisma.providerCredential.create({
      data: {
        userId,
        provider: 'GOOGLE',
        accessTokenEnc: 'v1.a.b.c',
        refreshTokenEnc: 'v1.d.e.f',
        expiresAt: new Date('2026-08-15T12:00:00Z'),
      },
    })
    expect({ calendarId: c.calendarId, scope: c.scope }).toEqual({ calendarId: '', scope: '' })
  })
})

describe('ExternalLink', () => {
  it('porte un etag, vide tant que rien n a été poussé', async () => {
    const l = await prisma.externalLink.create({
      data: { ...CIBLE, externalId: 'evt-1' },
    })
    expect(l.etag).toBe('')

    const relu = await prisma.externalLink.update({ where: { id: l.id }, data: { etag: '"3"' } })
    expect(relu.etag).toBe('"3"')
  })
})
