import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient, listClients } from './clients'
import { createMission, createLine, listActiveLines } from './missions'

let userId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'missions@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'missions@test.local' } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'ACME' } } })
  await prisma.$disconnect()
})

describe('clients et missions', () => {
  it('crée un client et le retrouve', async () => {
    const c = await createClient('ACME 38')
    expect(c.id).toBeTruthy()
    expect((await listClients()).some((x) => x.id === c.id)).toBe(true)
  })

  it('crée une ligne et son affectation automatiquement', async () => {
    const c = await createClient('ACME auto')
    const m = await createMission({ clientId: c.id, label: 'ITSM' })
    const l = await createLine({
      missionId: m.id,
      userId,
      label: 'Consultant ITSM',
      soldCentiemes: 3000,
      tjmCents: 80000,
    })

    const assignment = await prisma.assignment.findUnique({
      where: { lineId_userId: { lineId: l.id, userId } },
    })
    expect(assignment).not.toBeNull()
    expect(assignment!.soldCentiemes).toBe(3000)
  })

  it('porte deux lignes tarifées différemment sous une même mission', async () => {
    const c = await createClient('ACME deux lignes')
    const m = await createMission({ clientId: c.id, label: 'ITSM deux lignes' })
    await createLine({ missionId: m.id, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000 })
    await createLine({ missionId: m.id, userId, label: 'Nuit', soldCentiemes: 1000, tjmCents: 120000 })

    const lines = (await listActiveLines(userId)).filter((l) => l.missionLabel === 'ITSM deux lignes')
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.label).sort()).toEqual(['Jour', 'Nuit'])
  })

  it('hérite de minutesParJour des réglages quand la ligne ne le surcharge pas', async () => {
    const c = await createClient('ACME herit')
    const m = await createMission({ clientId: c.id, label: 'H' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const line = (await listActiveLines(userId)).find((l) => l.missionLabel === 'H')
    expect(line!.minutesParJour).toBe(480)
  })

  it('respecte la surcharge de minutesParJour au niveau de la ligne', async () => {
    const c = await createClient('ACME surcharge')
    const m = await createMission({ clientId: c.id, label: 'S' })
    await createLine({
      missionId: m.id,
      userId,
      label: 'L',
      soldCentiemes: 100,
      tjmCents: 0,
      minutesParJour: 432,
    })

    const line = (await listActiveLines(userId)).find((l) => l.missionLabel === 'S')
    expect(line!.minutesParJour).toBe(432)
  })

  it('ne renvoie que les lignes affectées à l utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre@test.local', name: 'A', passwordHash: 'x' },
    })
    const lines = await listActiveLines(autre.id)
    expect(lines).toHaveLength(0)
    await prisma.user.delete({ where: { id: autre.id } })
  })
})
