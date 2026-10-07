import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission } from '@/services/missions'
import { getOrCreateCra } from '@/services/cra'
import { cloreEnvoiCourant, listerEnvois } from './envois'

let userId = ''
let autreId = ''
let craId = ''

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: 'envois@test.local', name: 'T', passwordHash: 'x' } })).id
  autreId = (await prisma.user.create({ data: { email: 'envois-autre@test.local', name: 'A', passwordHash: 'x' } })).id
  const c = await createClient('ENVOIS client')
  const m = await createMission({ clientId: c.id, label: 'M', signataireNom: 'J', signataireEmail: 'j@c.test' })
  craId = (await getOrCreateCra(userId, m.id, '2026-09')).id
})

beforeEach(async () => {
  await prisma.signatureEnvoiClos.deleteMany({ where: { craId } })
  await prisma.signatureRequest.deleteMany({ where: { craId } })
})

afterAll(async () => {
  await prisma.signatureEnvoiClos.deleteMany({ where: { craId } })
  await prisma.signatureRequest.deleteMany({ where: { craId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: { in: ['envois@test.local', 'envois-autre@test.local'] } } })
  await prisma.client.deleteMany({ where: { name: 'ENVOIS client' } })
  await prisma.$disconnect()
})

async function demande(numero: number, status: string, motifRefus = '') {
  return prisma.signatureRequest.create({
    data: {
      craId, provider: 'double', status, numero, motifRefus,
      signataireNom: 'Jeanne', signataireEmail: 'j@c.test',
      sentAt: new Date(`2026-10-0${numero}T09:00:00Z`), empreinte: `e${numero}`,
    },
  })
}

describe('cloreEnvoiCourant', () => {
  it("recopie l'envoi en cours tel quel, motif compris", async () => {
    await demande(1, 'REFUSE', 'Il manque le 15.')
    await prisma.$transaction((tx) => cloreEnvoiCourant(tx, craId, new Date('2026-10-03T00:00:00Z')))
    const clos = await prisma.signatureEnvoiClos.findMany({ where: { craId } })
    expect(clos).toHaveLength(1)
    expect(clos[0]).toMatchObject({ numero: 1, status: 'REFUSE', motifRefus: 'Il manque le 15.', empreinte: 'e1' })
  })

  it('est idempotent : clore deux fois le même envoi ne le duplique pas', async () => {
    await demande(1, 'REFUSE')
    await prisma.$transaction((tx) => cloreEnvoiCourant(tx, craId, new Date()))
    await prisma.$transaction((tx) => cloreEnvoiCourant(tx, craId, new Date()))
    expect(await prisma.signatureEnvoiClos.count({ where: { craId } })).toBe(1)
  })

  it("ne fait rien quand aucun envoi n'existe", async () => {
    await prisma.$transaction((tx) => cloreEnvoiCourant(tx, craId, new Date()))
    expect(await prisma.signatureEnvoiClos.count({ where: { craId } })).toBe(0)
  })
})

describe('listerEnvois', () => {
  it("rend l'envoi en cours puis les envois clos, du plus récent au plus ancien", async () => {
    await demande(1, 'REFUSE', 'motif 1')
    await prisma.$transaction((tx) => cloreEnvoiCourant(tx, craId, new Date()))
    await prisma.signatureRequest.update({
      where: { craId }, data: { numero: 2, status: 'EN_ATTENTE', motifRefus: '', empreinte: 'e2' },
    })
    const envois = await listerEnvois(userId, craId)
    expect(envois.map((e) => [e.numero, e.status, e.enCours])).toEqual([
      [2, 'EN_ATTENTE', true],
      [1, 'REFUSE', false],
    ])
    expect(envois[1]!.motifRefus).toBe('motif 1')
  })

  it("ne rend rien du CRA d'un autre", async () => {
    await demande(1, 'EN_ATTENTE')
    expect(await listerEnvois(autreId, craId)).toEqual([])
  })
})
