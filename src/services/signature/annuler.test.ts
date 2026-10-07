import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import type { Mailer } from '@/services/notify'
import { createFakeSignatureConnector, type FakeSignatureConnector } from './fake-connector'
import { sendCraForSignature } from './send'
import { resoudreLien } from './lien-client'
import { annulerEnvoi } from './annuler'

process.env.AUTH_SECRET ??= 'secret-de-test-annuler'

const ORIGINE = 'https://cra.test'
let userId = ''
let missionId = ''
let lineId = ''
let craId = ''
let connector: FakeSignatureConnector
let corps: string[] = []
const mailer: Mailer = async (m) => {
  corps.push(m.corps)
}

function jetonDuDernierCourriel(): string {
  const m = /\/v\/([0-9a-f]{64})/.exec(corps.filter((c) => c.includes('/v/')).at(-1) ?? '')
  return m![1]!
}

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: 'annuler@test.local', name: 'T', passwordHash: 'x' } })).id
  const c = await createClient('ANNULER client')
  missionId = (await createMission({ clientId: c.id, label: 'ITSM', signataireNom: 'Jeanne Martin', signataireEmail: 'jeanne@client.test' })).id
  lineId = (await createLine({ missionId, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000 })).id
})

beforeEach(async () => {
  await prisma.lienClient.deleteMany({})
  await prisma.signatureEnvoiClos.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { userId } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
  corps = []
  connector = createFakeSignatureConnector()
  craId = (await getOrCreateCra(userId, missionId, '2026-09')).id
  await saveEntry({ userId, lineId, date: '2026-09-01', minutes: 480, kind: 'REALISE' })
  await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
})

afterAll(async () => {
  await prisma.lienClient.deleteMany({})
  await prisma.signatureEnvoiClos.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { userId } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'annuler@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'ANNULER client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('annulerEnvoi', () => {
  it('annule l enveloppe, révoque les liens, clôt l envoi et repasse en BROUILLON', async () => {
    const jeton = jetonDuDernierCourriel()
    const r = await annulerEnvoi(userId, craId, { connector, mailer })
    expect(r).toEqual({ ok: true })
    expect(connector.annulations).toEqual(['ext-1'])
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('BROUILLON')
    expect((await resoudreLien(jeton)).etat).toBe('RETIRE')
    expect(await prisma.signatureEnvoiClos.findMany({ where: { craId } })).toMatchObject([{ numero: 1, status: 'ANNULE' }])
    expect(corps.at(-1)).toContain('retiré')
  })

  it('PRESTATAIRE INJOIGNABLE : rien ne change, le lien reste valable', async () => {
    const jeton = jetonDuDernierCourriel()
    connector.faireEchouerAnnulation('panne')
    const r = await annulerEnvoi(userId, craId, { connector, mailer })
    expect(r).toMatchObject({ ok: false, raison: 'CONNECTEUR_EN_ECHEC' })
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('ENVOYE')
    expect((await resoudreLien(jeton)).etat).toBe('ACTIF')
  })

  it('refuse un CRA qui n est pas ENVOYE, et le CRA d un autre', async () => {
    await annulerEnvoi(userId, craId, { connector, mailer })
    expect(await annulerEnvoi(userId, craId, { connector, mailer })).toMatchObject({ ok: false, raison: 'TRANSITION_IMPOSSIBLE' })
    expect(await annulerEnvoi('autre', craId, { connector, mailer })).toMatchObject({ ok: false, raison: 'TRANSITION_IMPOSSIBLE' })
  })

  it('un renvoi après annulation numérote 2 et ne duplique pas l envoi clos', async () => {
    await annulerEnvoi(userId, craId, { connector, mailer })
    const r = await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect(r).toMatchObject({ ok: true, numero: 2 })
    expect(await prisma.signatureEnvoiClos.count({ where: { craId } })).toBe(1)
  })

  it('consigne signature.annulee et cra.rouvert', async () => {
    await annulerEnvoi(userId, craId, { connector, mailer })
    const actions = (await prisma.auditEvent.findMany({ where: { entityId: craId } })).map((e) => e.action)
    expect(actions).toContain('signature.annulee')
    expect(actions).toContain('cra.rouvert')
  })
})
