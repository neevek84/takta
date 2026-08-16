import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from './clients'
import { createLine, createMission } from './missions'
import { saveEntry } from './time-entries'
import { getOrCreateCra, listCrasNonClotures, transitionCra } from './cra'

// Fichier séparé de `cra.test.ts`, et non ajouté dedans : celui-ci est en
// cours de modification par le lot 3, et ses fixtures ne portent ni ligne
// saisissable ni second utilisateur.

let userId = ''
let autreUserId = ''
let missionId = ''
let lineId = ''

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'souffrance@test.local', name: 'K', passwordHash: 'x' } })
  ).id
  autreUserId = (
    await prisma.user.create({
      data: { email: 'souffrance-autre@test.local', name: 'A', passwordHash: 'x' },
    })
  ).id

  const c = await createClient('SOUFFRANCE client')
  missionId = (await createMission({ clientId: c.id, label: 'ITSM' })).id
  lineId = (await createLine({ missionId, userId, label: 'L', soldCentiemes: 10000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.auditEvent.deleteMany({})
  await prisma.assignment.deleteMany({ where: { lineId } })
  await prisma.missionLine.deleteMany({ where: { missionId } })
  await prisma.mission.deleteMany({ where: { id: missionId } })
  await prisma.client.deleteMany({ where: { name: 'SOUFFRANCE client' } })
  await prisma.user.deleteMany({
    where: { email: { in: ['souffrance@test.local', 'souffrance-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

describe('CRA non clôturés', () => {
  it('signale une mission saisie dont le CRA n existe pas encore', async () => {
    await saveEntry({ userId, lineId, date: '2026-04-06', minutes: 480, kind: 'REALISE' })

    const souffrance = await listCrasNonClotures(userId, '2026-04')
    expect(souffrance).toHaveLength(1)
    expect(souffrance[0]).toMatchObject({ missionId, status: 'ABSENT' })
  })

  it('NE CRÉE PAS le CRA qu il signale', async () => {
    await saveEntry({ userId, lineId, date: '2026-04-07', minutes: 480, kind: 'REALISE' })
    const avant = await prisma.cra.count()

    await listCrasNonClotures(userId, '2026-04')

    expect(await prisma.cra.count()).toBe(avant)
  })

  it('signale un CRA resté en brouillon', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-06', minutes: 480, kind: 'REALISE' })
    await getOrCreateCra(userId, missionId, '2026-05')

    expect((await listCrasNonClotures(userId, '2026-05'))[0]).toMatchObject({
      status: 'BROUILLON',
    })
  })

  it('ne signale pas un CRA déjà envoyé', async () => {
    await saveEntry({ userId, lineId, date: '2026-06-08', minutes: 480, kind: 'REALISE' })
    const cra = await getOrCreateCra(userId, missionId, '2026-06')
    await transitionCra(userId, cra.id, 'ENVOYER')

    expect(await listCrasNonClotures(userId, '2026-06')).toEqual([])
  })

  it('ne signale rien pour un mois sans aucune saisie', async () => {
    expect(await listCrasNonClotures(userId, '2026-03')).toEqual([])
  })

  it('isole par utilisateur', async () => {
    await saveEntry({ userId, lineId, date: '2026-04-08', minutes: 480, kind: 'REALISE' })
    expect(await listCrasNonClotures(autreUserId, '2026-04')).toEqual([])
  })
})
