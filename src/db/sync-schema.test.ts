import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from './client'

let userId = ''
let autreId = ''
let lineId = ''

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

  const c = await prisma.client.create({ data: { name: 'SYNC-SCHEMA client' } })
  const m = await prisma.mission.create({ data: { clientId: c.id, label: 'M' } })
  lineId = (await prisma.missionLine.create({ data: { missionId: m.id, label: 'L' } })).id
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
  await prisma.timeEntry.deleteMany({ where: { lineId } })
  await prisma.user.deleteMany({
    where: { email: { in: ['sync-schema@test.local', 'sync-schema-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'SYNC-SCHEMA client' } })
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

  // Une clé d'API Dolibarr appartient à l'instance, un jeton Google à une
  // personne. La tentation était de rendre `userId` nullable ; elle entre dans
  // la clé d'unicité, et un NULL n'étant jamais égal à un autre NULL, deux
  // clés d'instance du même fournisseur y seraient passées sans que rien ne
  // les arrête — la contrainte aurait cessé de contraindre en silence,
  // exactement la panne corrigée sur `TimeEntry.slotId` au lot 0. D'où
  // `ownerScope`, DANS la clé d'unicité, et un `userId` vide plutôt que nul.
  it("n'accepte qu'une seule clé d'instance par fournisseur", async () => {
    const base = {
      ownerScope: 'INSTANCE',
      userId: '',
      provider: 'DOLIBARR',
      accessTokenEnc: 'v1.a.b.c',
      refreshTokenEnc: 'v1.d.e.f',
    }
    await prisma.providerCredential.create({ data: base })
    await expect(prisma.providerCredential.create({ data: base })).rejects.toThrow()
    expect(await prisma.providerCredential.count()).toBe(1)
  })

  // Le pendant : la portée doit séparer, pas seulement interdire. Sans
  // `ownerScope` dans la clé, la clé d'instance et le jeton personnel du même
  // fournisseur se disputeraient la même ligne.
  it("laisse cohabiter une clé d'instance et un jeton personnel du même fournisseur", async () => {
    const base = {
      provider: 'DOLIBARR',
      accessTokenEnc: 'v1.a.b.c',
      refreshTokenEnc: 'v1.d.e.f',
    }
    await prisma.providerCredential.create({
      data: { ...base, ownerScope: 'INSTANCE', userId: '' },
    })
    await prisma.providerCredential.create({ data: { ...base, ownerScope: 'USER', userId } })
    await prisma.providerCredential.create({
      data: { ...base, ownerScope: 'USER', userId: autreId },
    })

    expect(await prisma.providerCredential.count()).toBe(3)
  })

  // Une clé d'API Dolibarr n'expire pas : la colonne doit accepter l'absence
  // d'échéance, sinon le connecteur devrait inventer une date lointaine et le
  // rafraîchissement se déclencherait sur une donnée fausse.
  it("accepte l'absence d'échéance, et naît personnelle", async () => {
    const c = await prisma.providerCredential.create({
      data: {
        userId: '',
        ownerScope: 'INSTANCE',
        provider: 'DOLIBARR',
        accessTokenEnc: 'v1.a.b.c',
        refreshTokenEnc: 'v1.d.e.f',
      },
    })
    expect(c.expiresAt).toBeNull()

    const personnel = await prisma.providerCredential.create({
      data: {
        userId,
        provider: 'GOOGLE',
        accessTokenEnc: 'v1.a.b.c',
        refreshTokenEnc: 'v1.d.e.f',
      },
    })
    // Le défaut porte la portée historique : les lignes Google déjà en base
    // restent personnelles sans qu'on ait à les réécrire.
    expect(personnel.ownerScope).toBe('USER')
  })
})

describe('ExternalLink', () => {
  it('porte un etag, vide tant que rien n a été poussé', async () => {
    const l = await prisma.externalLink.create({
      data: { ...CIBLE, userId, externalId: 'evt-1' },
    })
    expect(l.etag).toBe('')

    const relu = await prisma.externalLink.update({ where: { id: l.id }, data: { etag: '"3"' } })
    expect(relu.etag).toBe('"3"')
  })

  // Sans rattachement, supprimer un compte laissait ses liens en base pour
  // toujours : des lignes que plus aucune requête ne retrouve, puisque tout
  // le code les lit par `(entityType, entityId, provider)` — un triplet dont
  // l'`entityId` vient d'une saisie qui, elle, a bien disparu en cascade.
  it('disparaît avec son utilisateur', async () => {
    await prisma.externalLink.create({
      data: { ...CIBLE, userId: autreId, externalId: 'evt-autre' },
    })
    await prisma.user.delete({ where: { id: autreId } })
    expect(await prisma.externalLink.count()).toBe(0)

    const a = await prisma.user.create({
      data: { email: 'sync-schema-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    autreId = a.id
  })

  // Le pendant, et il compte autant : le lien ne suit PAS la saisie. C'est
  // lui, et lui seul, qui porte l'identifiant du bloc à retirer de l'agenda ;
  // la ligne `DELETE` mise en file par la suppression n'a rien d'autre à
  // consulter. Une clé étrangère `entityId -> TimeEntry` avec cascade
  // paraîtrait symétrique et rendrait le bloc fantôme définitif.
  it('survit à la saisie supprimée, sans quoi le bloc ne pourrait plus être retiré', async () => {
    const entry = await prisma.timeEntry.create({
      data: {
        lineId,
        userId,
        date: new Date('2026-03-12T00:00:00.000Z'),
        minutes: 240,
        kind: 'REALISE',
        minutesParJour: 480,
      },
    })
    await prisma.externalLink.create({
      data: {
        userId,
        entityType: 'TimeEntry',
        entityId: entry.id,
        provider: 'GOOGLE',
        externalId: 'evt-a-retirer',
      },
    })

    await prisma.timeEntry.delete({ where: { id: entry.id } })

    const reste = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: 'TimeEntry',
          entityId: entry.id,
          provider: 'GOOGLE',
        },
      },
    })
    expect(reste?.externalId).toBe('evt-a-retirer')
  })
})
