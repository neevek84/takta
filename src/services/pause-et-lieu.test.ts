import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { applyCellState } from './cells'
import { saveEntry } from './time-entries'
import type { CellState } from '@/core/saisie/cycle'

let userId = ''
let ligneDistance = ''
let ligneSite = ''

const JOUR = '2026-03-10'

function lire(lineId: string, date = JOUR) {
  return prisma.timeEntry.findFirstOrThrow({
    where: { userId, lineId, date: new Date(`${date}T00:00:00.000Z`) },
  })
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'pause@test.local', name: 'P', passwordHash: 'x' } })
  ).id
  const c = await createClient('PAUSE client')
  const aDistance = await createMission({ clientId: c.id, label: 'À distance' })
  const surSite = await createMission({ clientId: c.id, label: 'Sur site', lieuDefaut: 'SITE' })
  ligneDistance = (
    await createLine({ missionId: aDistance.id, userId, label: 'Conseil', soldCentiemes: 5000, tjmCents: 0 })
  ).id
  ligneSite = (
    await createLine({ missionId: surSite.id, userId, label: 'Atelier', soldCentiemes: 5000, tjmCents: 0 })
  ).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.syncOutbox.deleteMany({ where: { userId } })
  await updateSettings({
    minutesParJour: 420,
    capacityMode: 'DESACTIVE',
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
    pauseDebutMinute: 750,
    pauseFinMinute: 810,
  })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'pause@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'PAUSE client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('applyCellState — pause déjeuner', () => {
  it('fige la pause des réglages sur une journée entière, sans toucher au temps facturé', async () => {
    const r = await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r.ok).toBe(true)

    const e = await lire(ligneDistance)
    expect([e.minutes, e.startMinute, e.endMinute, e.pauseDebutMinute, e.pauseFinMinute]).toEqual([
      420, 540, 1020, 750, 810,
    ])
  })

  it('n en pose aucune quand le réglage est désactivé', async () => {
    await updateSettings({ pauseDebutMinute: 0, pauseFinMinute: 0 })
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const e = await lire(ligneDistance)
    expect([e.endMinute, e.pauseDebutMinute, e.pauseFinMinute]).toEqual([960, 0, 0])
  })

  it('écrit la pause que le formulaire envoie', async () => {
    const state: CellState = {
      kind: 'LIBRE',
      minutes: 420,
      slotId: '',
      startMinute: 480,
      endMinute: 960,
      eclatee: false,
      pause: { debutMinute: 720, finMinute: 780 },
    }
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state })

    const e = await lire(ligneDistance)
    expect([e.startMinute, e.endMinute, e.pauseDebutMinute, e.pauseFinMinute]).toEqual([480, 960, 720, 780])
  })

  it('refuse une pause qui ne tombe pas dans le bloc', async () => {
    const state: CellState = {
      kind: 'LIBRE',
      minutes: 120,
      slotId: '',
      startMinute: 540,
      endMinute: 660,
      eclatee: false,
      pause: { debutMinute: 750, finMinute: 810 },
    }
    expect(
      await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state }),
    ).toEqual({ ok: false, reason: 'SAISIE_INVALIDE' })
  })
})

describe('applyCellState — lieu', () => {
  it('reprend le lieu de la mission à la création', async () => {
    await applyCellState({ userId, lineId: ligneSite, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect((await lire(ligneSite)).lieu).toBe('SITE')
    expect((await lire(ligneDistance)).lieu).toBe('DISTANCE')
  })

  it('écrit le lieu que le formulaire choisit', async () => {
    const state: CellState = {
      kind: 'LIBRE',
      minutes: 240,
      slotId: '',
      startMinute: 540,
      endMinute: 780,
      eclatee: false,
      lieu: 'SITE',
    }
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state })
    expect((await lire(ligneDistance)).lieu).toBe('SITE')
  })

  it('garde le lieu de la saisie quand un clic la retouche', async () => {
    const libre: CellState = {
      kind: 'LIBRE',
      minutes: 420,
      slotId: '',
      startMinute: 540,
      endMinute: 1020,
      eclatee: false,
      lieu: 'SITE',
    }
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: libre })
    await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect((await lire(ligneDistance)).lieu).toBe('SITE')
  })

  it('refuse un lieu inconnu', async () => {
    const state = {
      kind: 'LIBRE',
      minutes: 240,
      slotId: '',
      startMinute: 540,
      endMinute: 780,
      eclatee: false,
      lieu: 'LUNE',
    } as unknown as CellState
    expect(
      await applyCellState({ userId, lineId: ligneDistance, date: JOUR, kind: 'REALISE', state }),
    ).toEqual({ ok: false, reason: 'SAISIE_INVALIDE' })
  })
})

describe('saveEntry — la vue tableau', () => {
  it('pose la pause sur une journée entière', async () => {
    await saveEntry({ userId, lineId: ligneSite, date: JOUR, minutes: 420, kind: 'REALISE' })

    const e = await lire(ligneSite)
    expect([e.endMinute, e.pauseDebutMinute, e.pauseFinMinute, e.lieu]).toEqual([1020, 750, 810, 'SITE'])
  })

  it('n en pose pas sur une durée partielle', async () => {
    await saveEntry({ userId, lineId: ligneDistance, date: JOUR, minutes: 240, kind: 'REALISE' })

    const e = await lire(ligneDistance)
    expect([e.endMinute, e.pauseDebutMinute, e.pauseFinMinute]).toEqual([780, 0, 0])
  })
})
