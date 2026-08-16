import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { getOrCreateCra, listCrasEnSouffrance } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import { createFakeSignatureConnector } from './fake-connector'
import { ENTITY_CRA } from './constants'
import { runSignatureReminders, RELANCES_MAX } from './reminders'

const MAINTENANT = new Date('2026-07-20T09:00:00.000Z')
const IL_Y_A_DIX_JOURS = new Date('2026-07-10T09:00:00.000Z')
const HIER = new Date('2026-07-19T09:00:00.000Z')

let userId = ''
let autreUserId = ''
let missionId = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'relance@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'relance-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreUserId = a.id

  const c = await createClient('RELANCE client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  await createLine({ missionId, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })
})

beforeEach(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId: { in: [userId, autreUserId] } } })
  await updateSettings({ relanceJours: 7 })

  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
  await prisma.cra.update({ where: { id: craId }, data: { status: 'ENVOYE' } })
})

afterAll(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.cra.deleteMany({ where: { userId: { in: [userId, autreUserId] } } })
  await prisma.user.deleteMany({
    where: { email: { in: ['relance@test.local', 'relance-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'RELANCE client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

async function demande(patch: Record<string, unknown> = {}): Promise<void> {
  await prisma.signatureRequest.create({
    data: { craId, provider: 'double', status: 'EN_ATTENTE', sentAt: IL_Y_A_DIX_JOURS, ...patch },
  })
  await prisma.externalLink.create({
    data: {
      // `userId` est obligatoire sur `ExternalLink` depuis la revue du lot 1b :
      // le plan l'omettait, et l'écriture aurait échoué avant toute assertion.
      userId,
      entityType: ENTITY_CRA,
      entityId: craId,
      provider: 'double',
      externalId: 'ext-1',
      syncState: 'EN_ATTENTE',
    },
  })
}

describe('runSignatureReminders', () => {
  it('relance une demande dont le délai est écoulé', async () => {
    await demande()
    const connector = createFakeSignatureConnector()

    const rapport = await runSignatureReminders({ now: MAINTENANT, connector })
    expect(rapport.relancees).toBe(1)
    expect(connector.relances).toEqual(['ext-1'])

    const relue = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(relue.relances).toBe(1)
    expect(relue.lastRelanceAt).not.toBeNull()
  })

  it('ne relance pas avant l échéance', async () => {
    await demande({ sentAt: HIER })
    const connector = createFakeSignatureConnector()
    expect((await runSignatureReminders({ now: MAINTENANT, connector })).relancees).toBe(0)
    expect(connector.relances).toEqual([])
  })

  it('compte le délai depuis la dernière relance, pas depuis l envoi', async () => {
    await demande({ relances: 1, lastRelanceAt: HIER })
    const connector = createFakeSignatureConnector()
    expect((await runSignatureReminders({ now: MAINTENANT, connector })).relancees).toBe(0)
  })

  it('ABANDONNE APRÈS TROIS RELANCES, sans toucher à l état du CRA', async () => {
    await demande({ relances: RELANCES_MAX, lastRelanceAt: IL_Y_A_DIX_JOURS })
    const connector = createFakeSignatureConnector()

    const rapport = await runSignatureReminders({ now: MAINTENANT, connector })
    expect(rapport).toMatchObject({ relancees: 0, abandonnees: 1 })
    expect(connector.relances).toEqual([])

    const relue = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(relue.abandoned).toBe(true)
    expect(relue.status).toBe('EN_ATTENTE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('relance exactement RELANCES_MAX fois, jamais une de plus', async () => {
    // Le compte, passage après passage : trois relances puis l'abandon. Un
    // seuil desserré d'un cran enverrait une quatrième relance ici, là où le
    // test d'abandon seul ne regarde qu'un état déjà arrivé au bout.
    await demande({ relances: 0 })
    const connector = createFakeSignatureConnector()

    for (let passage = 1; passage <= 5; passage += 1) {
      // Chaque passage se place dix jours après le précédent : l'échéance est
      // toujours écoulée, seul le compteur décide.
      const now = new Date(MAINTENANT.getTime() + passage * 10 * 24 * 60 * 60 * 1000)
      await runSignatureReminders({ now, connector })
    }

    expect(connector.relances).toEqual(['ext-1', 'ext-1', 'ext-1'])
    const relue = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(relue.relances).toBe(RELANCES_MAX)
    expect(relue.abandoned).toBe(true)
  })

  it('ne relance plus une demande abandonnée', async () => {
    await demande({ relances: RELANCES_MAX, abandoned: true, lastRelanceAt: IL_Y_A_DIX_JOURS })
    const rapport = await runSignatureReminders({
      now: MAINTENANT,
      connector: createFakeSignatureConnector(),
    })
    expect(rapport).toMatchObject({ relancees: 0, abandonnees: 0 })
  })

  it('ne relance jamais une demande achevée', async () => {
    await demande({ status: 'SIGNE', completedAt: IL_Y_A_DIX_JOURS })
    expect(
      (await runSignatureReminders({ now: MAINTENANT, connector: createFakeSignatureConnector() }))
        .relancees,
    ).toBe(0)
  })

  it('ne fait rien quand les relances sont désactivées', async () => {
    await updateSettings({ relanceJours: 0 })
    await demande()
    const connector = createFakeSignatureConnector()
    expect(await runSignatureReminders({ now: MAINTENANT, connector })).toEqual({
      relancees: 0,
      abandonnees: 0,
      sansConnecteur: 0,
      echecs: 0,
    })
    expect(connector.relances).toEqual([])
  })

  it('SANS CONNECTEUR, compte les demandes échues sans jamais échouer', async () => {
    await demande()
    const rapport = await runSignatureReminders({ now: MAINTENANT, connector: null })
    expect(rapport).toMatchObject({ relancees: 0, sansConnecteur: 1 })

    const relue = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(relue.relances).toBe(0)
  })

  it('un échec de relance n incrémente pas le compteur et n arrête pas le travail', async () => {
    await demande()
    const connector = createFakeSignatureConnector()
    const enPanne = {
      ...connector,
      remind: async () => {
        throw new Error('injoignable')
      },
    }

    const rapport = await runSignatureReminders({ now: MAINTENANT, connector: enPanne })
    expect(rapport).toMatchObject({ relancees: 0, echecs: 1 })

    const relue = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(relue.relances).toBe(0)
  })

  it('se scope sur un utilisateur quand on le lui demande', async () => {
    await demande()
    const connector = createFakeSignatureConnector()

    expect(
      (await runSignatureReminders({ userId: autreUserId, now: MAINTENANT, connector })).relancees,
    ).toBe(0)
    expect((await runSignatureReminders({ userId, now: MAINTENANT, connector })).relancees).toBe(1)
  })
})

describe('listCrasEnSouffrance', () => {
  it('remonte les CRA abandonnés, et eux seuls', async () => {
    await demande({ relances: RELANCES_MAX, abandoned: true })
    const souffrance = await listCrasEnSouffrance(userId)
    expect(souffrance.map((c) => c.id)).toEqual([craId])
    expect(souffrance[0]!.signature?.abandoned).toBe(true)
  })

  it('ne remonte rien tant que la demande suit son cours', async () => {
    await demande()
    expect(await listCrasEnSouffrance(userId)).toEqual([])
  })

  it('ne remonte pas les CRA d un autre utilisateur', async () => {
    await demande({ relances: RELANCES_MAX, abandoned: true })
    expect(await listCrasEnSouffrance(autreUserId)).toEqual([])
  })
})
