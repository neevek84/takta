import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry, getMonthEntries } from './time-entries'

let userId = ''
let lineA = ''
let lineB = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'entries@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id

  const c = await createClient('ENTRIES client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  lineA = (await createLine({ missionId: m.id, userId, label: 'A', soldCentiemes: 3000, tjmCents: 0 })).id
  lineB = (await createLine({ missionId: m.id, userId, label: 'B', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: 'entries@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'ENTRIES client' } })
  // Settings est un singleton partagé par toute la suite : le supprimer le
  // laisse être recréé avec ses valeurs par défaut par le prochain appel à
  // getSettings(), quel que soit l'ordre d'exécution des fichiers de test.
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('saveEntry', () => {
  it('enregistre une demi-journée', async () => {
    const r = await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r).toEqual({ ok: true, minutes: 240 })
  })

  it('accepte deux demi-journées sur deux lignes le même jour', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r.ok).toBe(true)
  })

  it('bloque le dépassement en mode BLOCAGE', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r).toEqual({ ok: false, reason: 'CAPACITE', totalMinutes: 720, capacityMinutes: 480 })
  })

  it('laisse passer le dépassement en mode AVERTISSEMENT', async () => {
    await updateSettings({ capacityMode: 'AVERTISSEMENT' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r.ok).toBe(true)
    expect((await getMonthEntries(userId, '2026-03')).length).toBe(2)
  })

  it('ne compte pas deux fois la valeur qu on est en train de corriger', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r).toEqual({ ok: true, minutes: 240 })
  })

  it('supprime la ligne quand on saisit zéro', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })
    expect(await getMonthEntries(userId, '2026-03')).toHaveLength(0)
  })

  it('applique la même règle un dimanche', async () => {
    // 2026-03-15 est un dimanche
    await saveEntry({ userId, lineId: lineA, date: '2026-03-15', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-15', minutes: 240, kind: 'REALISE' })
    expect(r.ok).toBe(false)
  })

  it('refuse toute écriture sur un mois dont le CRA est validé', async () => {
    const line = await prisma.missionLine.findUniqueOrThrow({ where: { id: lineA } })
    await prisma.cra.create({
      data: {
        missionId: line.missionId,
        userId,
        month: new Date('2026-04-01T00:00:00Z'),
        status: 'VALIDE',
      },
    })

    const r = await saveEntry({ userId, lineId: lineA, date: '2026-04-10', minutes: 480, kind: 'REALISE' })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })

    await prisma.cra.deleteMany({ where: { userId } })
  })

  it('ignore le contrôle en mode DESACTIVE', async () => {
    await updateSettings({ capacityMode: 'DESACTIVE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    expect(r.ok).toBe(true)
  })
})
