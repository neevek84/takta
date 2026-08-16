import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from './client'
import { GENESIS_HASH } from '@/core/audit/chain'

let userId = ''

beforeAll(async () => {
  await prisma.auditEvent.deleteMany({})
  const u = await prisma.user.create({
    data: { email: 'audit-schema@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
})

afterAll(async () => {
  await prisma.auditEvent.deleteMany({})
  await prisma.scheduledJob.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'audit-schema@test.local' } })
  await prisma.$disconnect()
})

describe('schéma du journal', () => {
  it('accepte une entrée ancrée à la genèse', async () => {
    const e = await prisma.auditEvent.create({
      data: {
        seq: 1,
        actorId: userId,
        actorLabel: 'T',
        action: 'cra.valide',
        entityType: 'Cra',
        entityId: 'cra_1',
        payloadJson: '{"month":"2026-07"}',
        prevHash: GENESIS_HASH,
        hash: 'h1',
      },
    })
    expect(e.seq).toBe(1)
    expect(e.prevHash).toBe('')
  })

  it('refuse deux entrées réclamant le même prédécesseur', async () => {
    // La fourche est interdite par la base elle-même, pas seulement par le
    // service : c'est ce qui protège entre deux processus.
    await expect(
      prisma.auditEvent.create({
        data: {
          seq: 2,
          action: 'cra.refuse',
          entityType: 'Cra',
          entityId: 'cra_2',
          prevHash: GENESIS_HASH,
          hash: 'h2',
        },
      }),
    ).rejects.toThrow()
  })

  it('refuse deux entrées de même numéro d ordre', async () => {
    await expect(
      prisma.auditEvent.create({
        data: {
          seq: 1,
          action: 'cra.refuse',
          entityType: 'Cra',
          entityId: 'cra_3',
          prevHash: 'h1',
          hash: 'h3',
        },
      }),
    ).rejects.toThrow()
  })

  it('survit à la suppression de son acteur', async () => {
    // Le journal ne cascade pas : supprimer un compte n'efface pas la preuve
    // de ce qu'il a fait.
    const ephemere = await prisma.user.create({
      data: { email: 'ephemere@test.local', name: 'E', passwordHash: 'x' },
    })
    await prisma.auditEvent.create({
      data: {
        seq: 2,
        actorId: ephemere.id,
        actorLabel: 'E',
        action: 'saisie.creee',
        entityType: 'TimeEntry',
        entityId: 't1',
        prevHash: 'h1',
        hash: 'h2',
      },
    })

    await prisma.user.delete({ where: { id: ephemere.id } })

    const relu = await prisma.auditEvent.findUniqueOrThrow({ where: { seq: 2 } })
    expect(relu.actorId).toBe(ephemere.id)
    expect(relu.actorLabel).toBe('E')
  })
})

describe('schéma des abonnements et de l ordonnanceur', () => {
  it('stocke les événements souscrits en chaîne, pas en tableau', async () => {
    const w = await prisma.webhook.create({
      data: {
        userId,
        label: 'n8n',
        url: 'https://exemple.test/hook',
        secret: 's',
        events: 'cra.valide,saisie.creee',
      },
    })
    expect(w.events).toBe('cra.valide,saisie.creee')
    expect(w.state).toBe('ACTIF')
    expect(w.lastSeq).toBe(0)
    await prisma.webhook.delete({ where: { id: w.id } })
  })

  it('ne met jamais deux fois le même événement en file pour un abonnement', async () => {
    const w = await prisma.webhook.create({
      data: { userId, label: 'l', url: 'https://exemple.test/h', secret: 's' },
    })
    await prisma.webhookDelivery.create({ data: { webhookId: w.id, seq: 1, action: 'cra.valide' } })
    await expect(
      prisma.webhookDelivery.create({ data: { webhookId: w.id, seq: 1, action: 'cra.valide' } }),
    ).rejects.toThrow()
    await prisma.webhook.delete({ where: { id: w.id } })
  })

  it('emporte ses livraisons quand l abonnement disparaît', async () => {
    const w = await prisma.webhook.create({
      data: { userId, label: 'l', url: 'https://exemple.test/h', secret: 's' },
    })
    await prisma.webhookDelivery.create({ data: { webhookId: w.id, seq: 9, action: 'cra.valide' } })
    await prisma.webhook.delete({ where: { id: w.id } })
    expect(await prisma.webhookDelivery.count({ where: { webhookId: w.id } })).toBe(0)
  })

  it('nomme les travaux de façon unique', async () => {
    await prisma.scheduledJob.create({ data: { name: 'test.travail', intervalMinutes: 5 } })
    await expect(
      prisma.scheduledJob.create({ data: { name: 'test.travail', intervalMinutes: 5 } }),
    ).rejects.toThrow()
  })

  it('porte les nouveaux réglages avec leurs défauts', async () => {
    const s = await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    })
    expect(s.webhookMaxEchecs).toBe(10)
    expect(s.notificationEmail).toBe('')
    expect(s.smtpPort).toBe(0)
    expect(s.smtpSecure).toBe(true)
  })
})
