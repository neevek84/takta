import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from './client'

let userId = ''
let clientId = ''
let missionId = ''
let lineId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'rates@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await prisma.client.create({ data: { name: 'RATES client', minutesParJour: 420 } })
  clientId = c.id
  const m = await prisma.mission.create({ data: { clientId, label: 'RATES mission' } })
  missionId = m.id
  const l = await prisma.missionLine.create({
    data: { missionId, label: 'L', soldCentiemes: 1000, tjmCents: 80000 },
  })
  lineId = l.id
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'rates@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'RATES client' } })
  await prisma.$disconnect()
})

describe('schéma des facteurs', () => {
  it('accepte une surcharge sur le client', async () => {
    const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId } })
    expect(c.minutesParJour).toBe(420)
  })

  it('laisse la surcharge de mission nulle par défaut', async () => {
    const m = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })
    expect(m.minutesParJour).toBeNull()
  })

  it('stocke le facteur sur la saisie', async () => {
    const e = await prisma.timeEntry.create({
      data: {
        lineId,
        userId,
        date: new Date('2026-05-04T00:00:00Z'),
        minutes: 420,
        kind: 'REALISE',
        minutesParJour: 420,
      },
    })
    expect(e.minutesParJour).toBe(420)
    expect(Number.isInteger(e.minutesParJour)).toBe(true)
  })

  it('conserve des facteurs différents sur deux saisies du même mois', async () => {
    const base = { lineId, userId, minutes: 240, kind: 'REALISE' }
    const a = await prisma.timeEntry.create({
      data: { ...base, date: new Date('2026-05-05T00:00:00Z'), minutesParJour: 420 },
    })
    const b = await prisma.timeEntry.create({
      data: { ...base, date: new Date('2026-05-06T00:00:00Z'), minutesParJour: 480 },
    })
    expect([a.minutesParJour, b.minutesParJour]).toEqual([420, 480])
  })
})
