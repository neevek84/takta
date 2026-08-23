import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { DUREE_MAXIMALE_JOURS, renvoyerVersAgenda } from './renvoi'

let userId = ''
let lineId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'renvoi@test.local', name: 'R', passwordHash: 'x', role: 'CONSULTANT' },
  })
  userId = u.id
  const c = await createClient('RENVOI ACME')
  const m = await createMission({ clientId: c.id, label: 'RENVOI Mission' })
  const l = await createLine({
    missionId: m.id,
    userId,
    label: 'Cadrage',
    soldCentiemes: 1000,
    tjmCents: 0,
  })
  lineId = l.id
})

beforeEach(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'renvoi@test.local' } })
  await prisma.$disconnect()
})

/** Une saisie écrite **sans** passer par la file : le cas que ce renvoi répare. */
async function saisieMuette(date: string, kind: 'REALISE' | 'PREVISIONNEL' = 'REALISE') {
  return prisma.timeEntry.create({
    data: {
      lineId,
      userId,
      date: new Date(`${date}T00:00:00.000Z`),
      minutes: 480,
      kind,
      slotId: '',
      startMinute: 540,
      endMinute: 1020,
      minutesParJour: 480,
    },
  })
}

/**
 * **Ce que ce renvoi répare.**
 *
 * Deux chemins ont écrit des saisies sans jamais les mettre en file : la
 * reprise Dolibarr — corrigée depuis, mais l'historique déjà repris reste
 * muet — et toute saisie antérieure à la connexion de l'agenda. Le porteur ne
 * voyait donc dans son agenda que les prévisionnels tapés à la main, et en a
 * conclu qu'un filtre écartait le réalisé. Il n'y en avait aucun.
 */
describe("renvoyer des saisies vers l'agenda", () => {
  it('met en file toute la période, réalisé compris', async () => {
    const a = await saisieMuette('2026-07-10', 'REALISE')
    const b = await saisieMuette('2026-07-20', 'PREVISIONNEL')

    const r = await renvoyerVersAgenda({ userId, du: '2026-07-01', au: '2026-07-31' })

    expect(r).toMatchObject({ ok: true, misesEnFile: 2 })
    const file = await prisma.syncOutbox.findMany({ where: { provider: 'GOOGLE' } })
    expect(file.map((l) => l.entityId).sort()).toEqual([a.id, b.id].sort())
  })

  it('ne sort pas de la période demandée', async () => {
    await saisieMuette('2026-06-30')
    const dedans = await saisieMuette('2026-07-15')
    await saisieMuette('2026-08-01')

    const r = await renvoyerVersAgenda({ userId, du: '2026-07-01', au: '2026-07-31' })

    expect(r.misesEnFile).toBe(1)
    const file = await prisma.syncOutbox.findMany({ where: { provider: 'GOOGLE' } })
    expect(file.map((l) => l.entityId)).toEqual([dedans.id])
  })

  // Les bornes comptent : un rattrapage « du 1er au 31 » qui saute le 31
  // laisse un trou que personne ne pense à chercher.
  it('inclut les deux bornes', async () => {
    await saisieMuette('2026-07-01')
    await saisieMuette('2026-07-31')

    expect((await renvoyerVersAgenda({ userId, du: '2026-07-01', au: '2026-07-31' })).misesEnFile)
      .toBe(2)
  })

  // La file est à cible unique : rejouer le renvoi remplace la ligne au lieu
  // de la doubler. Sans quoi deux clics feraient deux blocs.
  it('se rejoue sans rien doubler', async () => {
    await saisieMuette('2026-07-10')

    await renvoyerVersAgenda({ userId, du: '2026-07-01', au: '2026-07-31' })
    await renvoyerVersAgenda({ userId, du: '2026-07-01', au: '2026-07-31' })

    expect(await prisma.syncOutbox.count({ where: { provider: 'GOOGLE' } })).toBe(1)
  })

  it('ne touche pas aux saisies d un autre compte', async () => {
    const autre = await prisma.user.create({
      data: { email: 'renvoi-autre@test.local', name: 'A', passwordHash: 'x', role: 'CONSULTANT' },
    })
    await prisma.timeEntry.create({
      data: {
        lineId,
        userId: autre.id,
        date: new Date('2026-07-10T00:00:00.000Z'),
        minutes: 480,
        kind: 'REALISE',
        slotId: '',
        startMinute: 540,
        endMinute: 1020,
        minutesParJour: 480,
      },
    })

    const r = await renvoyerVersAgenda({ userId, du: '2026-07-01', au: '2026-07-31' })

    expect(r.misesEnFile).toBe(0)
    await prisma.timeEntry.deleteMany({ where: { userId: autre.id } })
    await prisma.user.delete({ where: { id: autre.id } })
  })
})

describe('les refus du renvoi', () => {
  // « 0 saisie » se lit comme « il n'y avait rien », pas comme « vos dates
  // sont à l'envers ».
  it('refuse une période inversée en le disant', async () => {
    const r = await renvoyerVersAgenda({ userId, du: '2026-07-31', au: '2026-07-01' })

    expect(r.ok).toBe(false)
    expect(r.motif).toMatch(/précède/i)
  })

  it('refuse une période trop longue', async () => {
    const r = await renvoyerVersAgenda({ userId, du: '2020-01-01', au: '2026-12-31' })

    expect(r.ok).toBe(false)
    expect(r.motif).toContain(String(DUREE_MAXIMALE_JOURS))
  })

  it('refuse ce qui n est pas une date', async () => {
    expect((await renvoyerVersAgenda({ userId, du: '', au: '2026-07-01' })).ok).toBe(false)
    expect((await renvoyerVersAgenda({ userId, du: '01/07/2026', au: '2026-07-01' })).ok).toBe(false)
  })

  it('n écrit rien quand il refuse', async () => {
    await saisieMuette('2026-07-10')

    await renvoyerVersAgenda({ userId, du: '2026-07-31', au: '2026-07-01' })

    expect(await prisma.syncOutbox.count()).toBe(0)
  })
})
