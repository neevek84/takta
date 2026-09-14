import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { applyCellState } from './cells'
import { saveEntry } from './time-entries'

let userId = ''
let ligneSite = ''
let ligneSiteRdv = ''
let ligneDistance = ''

const JOUR = '2026-03-10'
const MINUIT_DU_JOUR = new Date(`${JOUR}T00:00:00.000Z`)

function trajetsDuJour() {
  return prisma.trajet.findMany({
    where: { userId, date: MINUIT_DU_JOUR },
    orderBy: { startMinute: 'asc' },
    select: { startMinute: true, endMinute: true, summary: true },
  })
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'trajets@test.local', name: 'T', passwordHash: 'x' } })
  ).id
  const c = await createClient('TRAJETS client')
  const surSite = await createMission({ clientId: c.id, label: 'Chez eux', lieuDefaut: 'SITE' })
  const aDistance = await createMission({ clientId: c.id, label: 'De chez moi' })
  ligneSite = (await createLine({ missionId: surSite.id, userId, label: 'Atelier', soldCentiemes: 5000, tjmCents: 0 })).id
  ligneSiteRdv = (await createLine({ missionId: surSite.id, userId, label: 'Rendez-vous', soldCentiemes: 5000, tjmCents: 0 })).id
  ligneDistance = (await createLine({ missionId: aDistance.id, userId, label: 'Conseil', soldCentiemes: 5000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.trajet.deleteMany({ where: { userId } })
  await prisma.syncOutbox.deleteMany({ where: { userId } })
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
    // Sans pause : ce fichier décrit les trajets, la pause a les siens.
    pauseDebutMinute: 0,
    pauseFinMinute: 0,
    dureeTrajetMinutes: 30,
  })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'trajets@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'TRAJETS client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('pose des trajets', () => {
  it('pose un aller et un retour autour d une journée chez le client, et les met en file', async () => {
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect(await trajetsDuJour()).toEqual([
      { startMinute: 510, endMinute: 540, summary: 'Trajet · TRAJETS client' },
      { startMinute: 1020, endMinute: 1050, summary: 'Trajet · TRAJETS client' },
    ])
    expect(await prisma.syncOutbox.count({ where: { userId, entityType: 'Trajet' } })).toBe(2)
    const saisie = await prisma.timeEntry.findFirstOrThrow({ where: { userId, lineId: ligneSite } })
    expect(saisie.trajetsCalcules).toBe(true)
  })

  it('ne repose rien quand la saisie est retouchée', async () => {
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect(await trajetsDuJour()).toHaveLength(2)
  })

  it('ne pose rien à distance', async () => {
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(await trajetsDuJour()).toEqual([])
  })

  it('ne pose rien quand la durée de trajet est nulle, et pourra le faire plus tard', async () => {
    await updateSettings({ dureeTrajetMinutes: 0 })
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect(await trajetsDuJour()).toEqual([])
    const saisie = await prisma.timeEntry.findFirstOrThrow({ where: { userId, lineId: ligneSite } })
    expect(saisie.trajetsCalcules).toBe(false)
  })

  it('raccourcit l aller d un rendez-vous qui suit une journée', async () => {
    await applyCellState({
      userId,
      lineId: ligneSite,
      date: JOUR,
      kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 480, slotId: '', startMinute: 540, endMinute: 1020, eclatee: false },
    })
    await applyCellState({
      userId,
      lineId: ligneSiteRdv,
      date: JOUR,
      kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 60, slotId: '', startMinute: 1065, endMinute: 1125, eclatee: false },
    })

    expect((await trajetsDuJour()).map((t) => [t.startMinute, t.endMinute])).toEqual([
      [510, 540],
      [1020, 1050],
      [1050, 1065],
      [1125, 1155],
    ])
  })

  it('laisse les trajets en place quand la saisie est supprimée', async () => {
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'VIDE' } })

    expect(await trajetsDuJour()).toHaveLength(2)
  })

  it('pose aussi depuis la vue tableau', async () => {
    await saveEntry({ userId, lineId: ligneSite, date: JOUR, minutes: 240, kind: 'REALISE' })
    expect((await trajetsDuJour()).map((t) => [t.startMinute, t.endMinute])).toEqual([
      [510, 540],
      [780, 810],
    ])
  })
})
