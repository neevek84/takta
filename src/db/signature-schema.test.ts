import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from './client'

let userId = ''
let missionId = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'sig-schema@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await prisma.client.create({ data: { name: 'SIG SCHEMA client' } })
  const m = await prisma.mission.create({ data: { clientId: c.id, label: 'SIG SCHEMA mission' } })
  missionId = m.id
  const cra = await prisma.cra.create({
    data: { missionId, userId, month: new Date('2026-06-01T00:00:00.000Z') },
  })
  craId = cra.id
})

afterAll(async () => {
  await prisma.signatureWebhookEvent.deleteMany({ where: { provider: { in: ['test', 'autre'] } } })
  await prisma.user.deleteMany({ where: { email: 'sig-schema@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'SIG SCHEMA client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('signataire de la mission', () => {
  it('est vide par défaut — rien n est signable tant que rien n est saisi', async () => {
    const m = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })
    expect(m.signataireNom).toBe('')
    expect(m.signataireEmail).toBe('')
  })

  it('se renseigne au niveau de la mission, pas du client', async () => {
    const m = await prisma.mission.update({
      where: { id: missionId },
      data: { signataireNom: 'Claire Martin', signataireEmail: 'claire@acme.test' },
    })
    expect(m.signataireEmail).toBe('claire@acme.test')
  })
})

describe('identité de l émetteur et délai de relance', () => {
  it('sont vides et à sept jours par défaut', async () => {
    const s = await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    })
    expect(s.emetteurNom).toBe('')
    expect(s.emetteurAdresse).toBe('')
    expect(s.emetteurSiret).toBe('')
    expect(s.emetteurEmail).toBe('')
    expect(s.relanceJours).toBe(7)
  })
})

describe('SignatureRequest', () => {
  it('est unique par CRA — renvoyer remplace, jamais n empile', async () => {
    await prisma.signatureRequest.create({
      data: { craId, provider: 'test', signataireNom: 'C', signataireEmail: 'c@acme.test' },
    })
    await expect(
      prisma.signatureRequest.create({ data: { craId, provider: 'test' } }),
    ).rejects.toThrow()
  })

  it('démarre en attente, sans relance et sans PDF archivé', async () => {
    const r = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(r.status).toBe('EN_ATTENTE')
    expect(r.relances).toBe(0)
    expect(r.lastRelanceAt).toBeNull()
    expect(r.completedAt).toBeNull()
    expect(r.abandoned).toBe(false)
    expect(r.signedPdf).toBeNull()
  })

  it('archive des octets et les rend à l identique', async () => {
    const octets = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0xff])
    await prisma.signatureRequest.update({ where: { craId }, data: { signedPdf: octets } })
    const relu = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(Buffer.from(relu.signedPdf!)).toEqual(octets)
  })

  it('disparaît avec son CRA', async () => {
    const autre = await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00.000Z') },
    })
    await prisma.signatureRequest.create({ data: { craId: autre.id, provider: 'test' } })
    await prisma.cra.delete({ where: { id: autre.id } })
    expect(await prisma.signatureRequest.findUnique({ where: { craId: autre.id } })).toBeNull()
  })
})

describe('SignatureWebhookEvent', () => {
  it('refuse deux fois le même événement du même prestataire', async () => {
    await prisma.signatureWebhookEvent.create({
      data: { provider: 'test', eventId: 'DOCUMENT_COMPLETED:42' },
    })
    await expect(
      prisma.signatureWebhookEvent.create({
        data: { provider: 'test', eventId: 'DOCUMENT_COMPLETED:42' },
      }),
    ).rejects.toThrow()
  })

  // Le brief posait ici un second événement du **même** prestataire sous un
  // identifiant différent : la contrainte porte sur le couple, ce test-là
  // serait passé même sans elle. C'est bien le prestataire qu'on fait varier,
  // à identifiant identique.
  it('accepte le même identifiant chez deux prestataires différents', async () => {
    const autre = await prisma.signatureWebhookEvent.create({
      data: { provider: 'autre', eventId: 'DOCUMENT_COMPLETED:42' },
    })
    expect(autre.id).not.toBe('')
    expect(
      await prisma.signatureWebhookEvent.count({ where: { eventId: 'DOCUMENT_COMPLETED:42' } }),
    ).toBe(2)
  })
})
