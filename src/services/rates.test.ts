import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry } from './time-entries'
import { previewRecalibration, recalibrateOpenMonths } from './rates'
import { readAuditSince } from './audit'

let userId = ''
let missionId = ''
let lineId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'recal@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('RECAL client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  lineId = (await createLine({
    missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 80000,
  })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'recal@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'RECAL client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('réétalonnage', () => {
  it('réétalonne une saisie d un mois ouvert', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-01', minutes: 480, kind: 'REALISE' })
    await updateSettings({ minutesParJour: 420 })

    const r = await recalibrateOpenMonths(userId)
    expect(r).toEqual({ recalibrees: 1, sauteesVerrouillees: 0 })

    const e = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
    expect(e.minutesParJour).toBe(420)
  })

  it('ne touche JAMAIS une saisie d un mois validé', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-02', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })
    await updateSettings({ minutesParJour: 420 })

    const r = await recalibrateOpenMonths(userId)
    expect(r).toEqual({ recalibrees: 0, sauteesVerrouillees: 1 })

    const e = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
    expect(e.minutesParJour).toBe(480)
  })

  it('traite le mois ouvert et saute le mois validé du même utilisateur', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-03', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })
    await updateSettings({ minutesParJour: 420 })

    const r = await recalibrateOpenMonths(userId)
    expect(r).toEqual({ recalibrees: 1, sauteesVerrouillees: 1 })
  })

  it('annonce à l avance ce qu il va faire', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-08-04', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })
    await updateSettings({ minutesParJour: 420 })

    expect(await previewRecalibration(userId)).toEqual({ concernees: 1, verrouillees: 1 })
  })

  it('ne touche pas aux saisies d un autre utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-recal@test.local', name: 'A', passwordHash: 'x' },
    })
    await prisma.timeEntry.create({
      data: {
        lineId, userId: autre.id, date: new Date('2026-07-05T00:00:00Z'),
        minutes: 480, kind: 'REALISE', minutesParJour: 480,
      },
    })
    await updateSettings({ minutesParJour: 420 })

    const r = await recalibrateOpenMonths(userId)
    expect(r.recalibrees).toBe(0)

    const e = await prisma.timeEntry.findFirstOrThrow({ where: { userId: autre.id } })
    expect(e.minutesParJour).toBe(480)

    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('ne fait rien quand aucun facteur n a changé', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-06', minutes: 480, kind: 'REALISE' })
    expect(await recalibrateOpenMonths(userId)).toEqual({ recalibrees: 0, sauteesVerrouillees: 0 })
  })
})

describe('consignation du réétalonnage', () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({})
  })

  it('consigne un réétalonnage effectif', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-11', minutes: 480, kind: 'REALISE' })
    await prisma.auditEvent.deleteMany({})
    await updateSettings({ minutesParJour: 420 })
    await prisma.auditEvent.deleteMany({})

    await recalibrateOpenMonths(userId)

    const journal = await readAuditSince({ since: 0 })
    expect(journal[0]).toMatchObject({
      action: 'reetalonnage.effectue', entityType: 'Settings', entityId: 'singleton', actorId: userId,
    })
    expect(journal[0]!.payload).toMatchObject({ recalibrees: 1, sauteesVerrouillees: 0 })
  })

  it('ne consigne rien quand rien n a bougé', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-12', minutes: 480, kind: 'REALISE' })
    await prisma.auditEvent.deleteMany({})

    expect(await recalibrateOpenMonths(userId)).toEqual({ recalibrees: 0, sauteesVerrouillees: 0 })
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })

  it('ne consigne pas la prévisualisation', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-13', minutes: 480, kind: 'REALISE' })
    await updateSettings({ minutesParJour: 420 })
    await prisma.auditEvent.deleteMany({})

    await previewRecalibration(userId)
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })
})
