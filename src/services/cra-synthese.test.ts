import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { syntheseParMission } from './cra-synthese'

let userId = ''
let autreId = ''
let missionId = ''
let ligneJour = ''
let ligneNuit = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'synthese@test.local', name: 'S', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'synthese-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id
})

beforeEach(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'SYN' } } })
  const client = await createClient('SYN Client')
  const mission = await createMission({ clientId: client.id, label: 'SYN Mission' })
  missionId = mission.id
  ligneJour = (
    await createLine({ missionId, userId, label: 'Consultant', soldCentiemes: 0, tjmCents: 0 })
  ).id
  ligneNuit = (
    await createLine({ missionId, userId, label: 'Astreinte', soldCentiemes: 0, tjmCents: 0 })
  ).id
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'SYN' } } })
  await prisma.user.deleteMany({
    where: { email: { in: ['synthese@test.local', 'synthese-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

async function saisir(args: {
  lineId: string
  date: string
  minutes: number
  kind?: 'REALISE' | 'PREVISIONNEL'
  minutesParJour?: number
  user?: string
}): Promise<void> {
  await prisma.timeEntry.create({
    data: {
      lineId: args.lineId,
      userId: args.user ?? userId,
      date: new Date(`${args.date}T00:00:00.000Z`),
      minutes: args.minutes,
      minutesParJour: args.minutesParJour ?? 420,
      kind: args.kind ?? 'REALISE',
      slotId: `${args.kind ?? 'REALISE'}-${args.minutes}`,
      startMinute: 540 + args.minutes,
    },
  })
}

describe('syntheseParMission', () => {
  it('additionne le réalisé du mois, prestation par prestation', async () => {
    await saisir({ lineId: ligneJour, date: '2026-03-02', minutes: 420 })
    await saisir({ lineId: ligneJour, date: '2026-03-03', minutes: 210 })
    await saisir({ lineId: ligneNuit, date: '2026-03-03', minutes: 420 })

    const s = (await syntheseParMission({ userId, missionIds: [missionId], month: '2026-03' })).get(
      missionId,
    )

    expect(s?.totalCentiemes).toBe(250)
    // Deux dates servies, même si l'une porte deux saisies.
    expect(s?.joursServis).toBe(2)
    // Par poids décroissant : c'est la prestation la plus servie qui décrit le mois.
    expect(s?.lignes).toEqual([
      { label: 'Consultant', centiemes: 150 },
      { label: 'Astreinte', centiemes: 100 },
    ])
  })

  it('écarte le prévisionnel : c’est le réalisé que le client signe', async () => {
    await saisir({ lineId: ligneJour, date: '2026-03-02', minutes: 420 })
    await saisir({ lineId: ligneJour, date: '2026-03-04', minutes: 420, kind: 'PREVISIONNEL' })

    const s = (await syntheseParMission({ userId, missionIds: [missionId], month: '2026-03' })).get(
      missionId,
    )
    expect(s?.totalCentiemes).toBe(100)
  })

  it('écarte les autres mois', async () => {
    await saisir({ lineId: ligneJour, date: '2026-03-31', minutes: 420 })
    await saisir({ lineId: ligneJour, date: '2026-04-01', minutes: 420 })

    const s = (await syntheseParMission({ userId, missionIds: [missionId], month: '2026-03' })).get(
      missionId,
    )
    expect(s?.totalCentiemes).toBe(100)
  })

  it('écarte les saisies d’un autre consultant', async () => {
    await saisir({ lineId: ligneJour, date: '2026-03-02', minutes: 420 })
    await saisir({ lineId: ligneJour, date: '2026-03-03', minutes: 420, user: autreId })

    const s = (await syntheseParMission({ userId, missionIds: [missionId], month: '2026-03' })).get(
      missionId,
    )
    expect(s?.totalCentiemes).toBe(100)
  })

  it('convertit chaque saisie avec SON facteur, jamais avec un facteur commun', async () => {
    // Le gel du facteur se casse en lecture : convertir le total avec le
    // réglage courant ferait bouger un CRA validé sans qu'aucune donnée n'ait
    // changé.
    await saisir({ lineId: ligneJour, date: '2026-03-02', minutes: 420, minutesParJour: 420 })
    await saisir({ lineId: ligneNuit, date: '2026-03-03', minutes: 480, minutesParJour: 480 })

    const s = (await syntheseParMission({ userId, missionIds: [missionId], month: '2026-03' })).get(
      missionId,
    )
    expect(s?.totalCentiemes).toBe(200)
  })

  it('ne rend rien pour une mission sans saisie', async () => {
    const par = await syntheseParMission({ userId, missionIds: [missionId], month: '2026-03' })
    expect(par.get(missionId)).toBeUndefined()
  })
})
