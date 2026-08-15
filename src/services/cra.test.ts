import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { getOrCreateCra, transitionCra, listCras, updateInvoiceTracking } from './cra'
import { InvalidTransitionError } from '@/core/cra/state-machine'

let userId = ''
let missionId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'cra@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('CRA client')
  const m = await createMission({ clientId: c.id, label: 'ITSM' })
  missionId = m.id
  await createLine({ missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 0 })
})

beforeEach(async () => {
  await prisma.cra.deleteMany({ where: { userId } })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'cra@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'CRA client' } })
  await prisma.$disconnect()
})

describe('CRA', () => {
  it('crée un CRA en brouillon', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    expect(cra.status).toBe('BROUILLON')
    expect(cra.month).toBe('2026-03')
    expect(cra.missionLabel).toBe('ITSM')
  })

  it('est idempotent sur le même mois', async () => {
    const a = await getOrCreateCra(userId, missionId, '2026-03')
    const b = await getOrCreateCra(userId, missionId, '2026-03')
    expect(a.id).toBe(b.id)
  })

  it('suit le parcours manuel jusqu à VALIDE', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    const envoye = await transitionCra(userId, cra.id, 'ENVOYER')
    expect(envoye.status).toBe('ENVOYE')
    const valide = await transitionCra(userId, cra.id, 'VALIDER')
    expect(valide.status).toBe('VALIDE')
  })

  it('refuse une transition interdite', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await expect(transitionCra(userId, cra.id, 'VALIDER')).rejects.toThrow(InvalidTransitionError)
  })

  it('permet de rouvrir un CRA validé', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')
    const rouvert = await transitionCra(userId, cra.id, 'ROUVRIR')
    expect(rouvert.status).toBe('BROUILLON')
  })

  it('refuse d agir sur le CRA d un autre utilisateur', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    const autre = await prisma.user.create({
      data: { email: 'autre-cra@test.local', name: 'A', passwordHash: 'x' },
    })
    await expect(transitionCra(autre.id, cra.id, 'ENVOYER')).rejects.toThrow()
    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('enregistre le suivi de facturation sans rien calculer', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    const r = await updateInvoiceTracking(userId, cra.id, {
      invoiceNumber: 'FA2603-0012',
      invoicedAt: new Date('2026-04-02T00:00:00Z'),
    })
    expect(r.invoiceNumber).toBe('FA2603-0012')
    expect(r.invoicedAt?.toISOString()).toBe('2026-04-02T00:00:00.000Z')
    expect(r.paidAt).toBeNull()
  })

  it('liste les CRA d un mois', async () => {
    await getOrCreateCra(userId, missionId, '2026-03')
    const list = await listCras(userId, '2026-03')
    expect(list).toHaveLength(1)
    expect(list[0]!.clientName).toBe('CRA client')
  })
})
