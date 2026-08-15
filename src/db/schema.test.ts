import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from './client'

describe('schéma', () => {
  let userId = ''
  let lineId = ''

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: 'schema@test.local', name: 'Test', passwordHash: 'x' },
    })
    userId = user.id

    const client = await prisma.client.create({ data: { name: 'Client test' } })
    const mission = await prisma.mission.create({
      data: { clientId: client.id, label: 'Mission test' },
    })
    const line = await prisma.missionLine.create({
      data: { missionId: mission.id, label: 'Consultant ITSM', soldCentiemes: 3000, tjmCents: 80000 },
    })
    lineId = line.id
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'schema@test.local' } })
    await prisma.client.deleteMany({ where: { name: 'Client test' } })
    await prisma.$disconnect()
  })

  it('stocke le temps en entiers', async () => {
    const entry = await prisma.timeEntry.create({
      data: { lineId, userId, date: new Date('2026-03-12T00:00:00Z'), minutes: 240, kind: 'REALISE' },
    })
    expect(entry.minutes).toBe(240)
    expect(Number.isInteger(entry.minutes)).toBe(true)
  })

  it('refuse un doublon à la journée, le cas réellement utilisé', async () => {
    // slotId omis -> défaut '' : c'est 100 % des lignes du lot 0.
    // Avec une colonne nullable, ce test passerait à tort (NULL n'est jamais
    // égal à NULL dans un index unique) — d'où la sentinelle.
    const data = {
      lineId,
      userId,
      date: new Date('2026-03-13T00:00:00Z'),
      minutes: 480,
      kind: 'REALISE',
    }
    await prisma.timeEntry.create({ data })
    await expect(prisma.timeEntry.create({ data })).rejects.toThrow()
  })

  it('autorise deux créneaux distincts le même jour sur la même ligne', async () => {
    const base = {
      lineId,
      userId,
      date: new Date('2026-03-14T00:00:00Z'),
      minutes: 240,
      kind: 'REALISE',
    }
    await prisma.timeEntry.create({ data: { ...base, slotId: 'matin' } })
    const second = await prisma.timeEntry.create({ data: { ...base, slotId: 'apres-midi' } })
    expect(second.slotId).toBe('apres-midi')
  })

  it('crée les réglages en singleton avec les valeurs par défaut', async () => {
    const s = await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: {},
      update: {},
    })
    expect(s.minutesParJour).toBe(480)
    expect(s.capacityMode).toBe('AVERTISSEMENT')
    expect(s.workingDays).toBe('1,2,3,4,5')
  })
})
