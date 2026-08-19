import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { compterPrevisionnelParMission } from './cra-previsionnel'

let userId = ''
let missionId = ''
let lineId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'prev@test.local', name: 'P', passwordHash: 'x' },
  })
  userId = u.id
})

beforeEach(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'PREV' } } })
  const client = await createClient('PREV Client')
  const mission = await createMission({ clientId: client.id, label: 'PREV Mission' })
  missionId = mission.id
  const ligne = await createLine({
    missionId,
    label: 'Consultant',
    userId,
    soldCentiemes: 3000,
    tjmCents: 0,
  })
  lineId = ligne.id
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'PREV' } } })
  await prisma.user.deleteMany({ where: { email: 'prev@test.local' } })
  await prisma.$disconnect()
})

async function saisir(date: string, kind: 'REALISE' | 'PREVISIONNEL'): Promise<string> {
  const e = await prisma.timeEntry.create({
    data: {
      lineId,
      userId,
      date: new Date(`${date}T00:00:00.000Z`),
      minutes: 420,
      minutesParJour: 420,
      kind,
      slotId: kind,
      startMinute: kind === 'REALISE' ? 540 : 600,
    },
  })
  return e.id
}

describe('le prévisionnel emporté par la validation', () => {
  it('annule le prévisionnel du mois, et laisse le réalisé intact', async () => {
    // Un jour prévu qui n'a pas eu lieu au moment où le mois se ferme n'aura
    // plus lieu : le laisser vivre le figerait pour toujours, tout en le
    // comptant comme consommé sur l'engagement de la mission.
    await saisir('2026-03-02', 'REALISE')
    await saisir('2026-03-03', 'PREVISIONNEL')
    await saisir('2026-03-04', 'PREVISIONNEL')

    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    const restantes = await prisma.timeEntry.findMany({ where: { lineId }, select: { kind: true } })
    expect(restantes.map((e) => e.kind)).toEqual(['REALISE'])
  })

  it('ne touche pas au prévisionnel des autres mois', async () => {
    await saisir('2026-03-03', 'PREVISIONNEL')
    const suivant = await saisir('2026-04-03', 'PREVISIONNEL')

    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    expect(await prisma.timeEntry.findUnique({ where: { id: suivant } })).not.toBeNull()
  })

  it('met en file la disparition des blocs d’agenda', async () => {
    // Sans cela, le bloc du jour prévu resterait dans Google pour l'éternité,
    // sur un jour qui n'aura pas lieu.
    const prevu = await saisir('2026-03-03', 'PREVISIONNEL')
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    const enFile = await prisma.syncOutbox.findFirst({
      where: { entityType: 'TimeEntry', entityId: prevu, operation: 'DELETE' },
    })
    expect(enFile).not.toBeNull()
  })

  it('consigne au journal ce que la validation a emporté', async () => {
    await saisir('2026-03-03', 'PREVISIONNEL')
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')

    const evenement = await prisma.auditEvent.findFirst({
      where: { entityType: 'Cra', entityId: cra.id },
      orderBy: { seq: 'desc' },
    })
    expect(String(evenement?.payloadJson ?? '')).toContain('"previsionnelAnnule":1')
  })

  it('ne compte le prévisionnel que du mois et de la mission demandés', async () => {
    await saisir('2026-03-03', 'PREVISIONNEL')
    await saisir('2026-03-04', 'PREVISIONNEL')
    await saisir('2026-04-03', 'PREVISIONNEL')
    await saisir('2026-03-05', 'REALISE')

    const par = await compterPrevisionnelParMission({ userId, missionIds: [missionId], month: '2026-03' })
    expect(par.get(missionId)).toBe(2)
  })

  it('ne compte rien quand aucune mission n’est demandée', async () => {
    await saisir('2026-03-03', 'PREVISIONNEL')
    const par = await compterPrevisionnelParMission({ userId, missionIds: [], month: '2026-03' })
    expect(par.size).toBe(0)
  })
})
