import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry } from './time-entries'
import { buildChargeMatrix } from './charge'

let userId = ''
let lineJour = ''
let lineNuit = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'charge@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id

  const c = await createClient('CHARGE client')
  const m = await createMission({ clientId: c.id, label: 'ITSM' })
  lineJour = (await createLine({
    missionId: m.id, userId, label: 'Consultant ITSM',
    soldCentiemes: 3000, tjmCents: 80000,
  })).id
  lineNuit = (await createLine({
    missionId: m.id, userId, label: 'Consultant ITSM Nuit',
    soldCentiemes: 1000, tjmCents: 120000,
  })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    debutExerciceMois: 4,
    objectifCaExerciceCents: 15_000_000,
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'charge@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'CHARGE client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('buildChargeMatrix', () => {
  it('couvre les douze mois de l exercice, d avril à mars', async () => {
    const m = await buildChargeMatrix(userId, 2026)
    expect(m.fiscalYear.label).toBe('Exercice 2026-2027')
    expect(m.fiscalYear.months).toHaveLength(12)
    expect(m.fiscalYear.months[0]).toBe('2026-04')
    expect(m.fiscalYear.months[11]).toBe('2027-03')
    expect(m.rows[0]!.cells).toHaveLength(12)
  })

  it('range chaque saisie dans la colonne de son mois', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineJour, date: '2027-01-08', minutes: 240, kind: 'PREVISIONNEL' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.cells[1]!.realiseCentiemes).toBe(100)   // 2026-05
    expect(row.cells[9]!.prevuCentiemes).toBe(50)      // 2027-01
    expect(row.cells[0]!.realiseCentiemes).toBe(0)
  })

  it('ignore les saisies hors de l exercice demandé', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-03-10', minutes: 480, kind: 'REALISE' })
    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.cells.every((c) => c.realiseCentiemes === 0)).toBe(true)
  })

  it('calcule le CA du mois avec le TJM de chaque ligne', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineNuit, date: '2026-05-13', minutes: 480, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    expect(m.monthTotals[1]!.caCents).toBe(200000)
    expect(m.monthTotals[1]!.centiemes).toBe(200)
  })

  it('reprend computeEngagement pour le reste à planifier par ligne', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480 * 18, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.engagement.venduCentiemes).toBe(3000)
    expect(row.engagement.realiseCentiemes).toBe(1800)
    expect(row.engagement.resteCentiemes).toBe(1200)
  })

  it('compte l engagement d une ligne sur toutes les périodes, pas seulement l exercice', async () => {
    // Saisie dans l exercice précédent : elle ne doit pas apparaître dans les
    // cellules, mais doit bien compter dans l engagement de la ligne.
    await saveEntry({ userId, lineId: lineJour, date: '2026-03-10', minutes: 480 * 5, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    const row = m.rows.find((r) => r.lineId === lineJour)!
    expect(row.cells.every((c) => c.realiseCentiemes === 0)).toBe(true)
    expect(row.engagement.realiseCentiemes).toBe(500)
  })

  it('calcule l avancement de l exercice et le reste à vendre', async () => {
    await saveEntry({ userId, lineId: lineJour, date: '2026-05-12', minutes: 480 * 10, kind: 'REALISE' })

    const m = await buildChargeMatrix(userId, 2026)
    // 10 jours × 800 € = 8 000 € = 800 000 centimes
    expect(m.progress.objectifCents).toBe(15_000_000)
    expect(m.progress.realiseCents).toBe(800_000)
    expect(m.progress.prevuCents).toBe(0)
    expect(m.progress.resteAVendreCents).toBe(14_200_000)
  })

  it('traduit le reste à vendre en jours au TJM moyen pondéré', async () => {
    const m = await buildChargeMatrix(userId, 2026)
    // (80000*3000 + 120000*1000) / 4000 = 90 000 centimes par jour
    // 15 000 000 / 90 000 = 166,66... jours
    expect(m.resteEnJoursCentiemes).toBe(16667)
  })

  it('ne renvoie aucune ligne pour un utilisateur sans affectation', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-charge@test.local', name: 'A', passwordHash: 'x' },
    })
    const m = await buildChargeMatrix(autre.id, 2026)
    expect(m.rows).toHaveLength(0)
    expect(m.monthTotals.every((t) => t.caCents === 0)).toBe(true)
    await prisma.user.delete({ where: { id: autre.id } })
  })
})
