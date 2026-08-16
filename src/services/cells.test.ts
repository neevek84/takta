import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings, DEFAULT_SLOTS } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { getMonthEntries } from './time-entries'
import { applyCellState, isMonthLocked } from './cells'

let userId = ''
let autreId = ''
let missionId = ''
let ligneJour = ''
let ligneNuit = ''
let ligneAutre = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'cells@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'cells-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('CELLS client')
  const m = await createMission({ clientId: c.id, label: 'CELLS mission' })
  missionId = m.id

  ligneJour = (await createLine({
    missionId, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000,
  })).id
  ligneNuit = (await createLine({
    missionId, userId, label: 'Nuit', soldCentiemes: 1000, tjmCents: 120000,
    allowedSlotIds: ['matin', 'apres-midi'],
  })).id
  ligneAutre = (await createLine({
    missionId, userId: autreId, label: 'Autre', soldCentiemes: 1000, tjmCents: 0,
  })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    capacityCentiemes: 100,
    workingDays: [1, 2, 3, 4, 5],
    holidays: [],
    slots: DEFAULT_SLOTS,
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { in: ['cells@test.local', 'cells-autre@test.local'] } } })
  await prisma.client.deleteMany({ where: { name: 'CELLS client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

async function saisiesDu(lineId: string, date: string) {
  return prisma.timeEntry.findMany({
    where: { lineId, date: new Date(`${date}T00:00:00.000Z`) },
    orderBy: { slotId: 'asc' },
    select: { minutes: true, slotId: true, kind: true, minutesParJour: true, userId: true },
  })
}

describe('applyCellState', () => {
  it('pose une journée entière sur une case vide', async () => {
    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })
    expect(r.ok).toBe(true)
    expect(await saisiesDu(ligneJour, '2026-03-02')).toEqual([
      { minutes: 480, slotId: '', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })

  it('remplace la journée par une demi-journée sans laisser de résidu', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })

    expect(await saisiesDu(ligneJour, '2026-03-02')).toEqual([
      { minutes: 240, slotId: 'matin', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })

  it('vide la case sans rien laisser derrière', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'DEMI', slotId: 'apres-midi' } })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-02', kind: 'REALISE', state: { kind: 'VIDE' } })

    expect(await saisiesDu(ligneJour, '2026-03-02')).toEqual([])
  })

  it('fige le facteur de conversion en vigueur à l écriture', async () => {
    await updateSettings({ minutesParJour: 420 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-03', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    expect(await saisiesDu(ligneJour, '2026-03-03')).toEqual([
      { minutes: 420, slotId: '', kind: 'REALISE', minutesParJour: 420, userId },
    ])
  })

  it('écrit le prévisionnel quand on le lui demande', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-04', kind: 'PREVISIONNEL', state: { kind: 'JOURNEE' } })
    const [saisie] = await saisiesDu(ligneJour, '2026-03-04')
    expect(saisie!.kind).toBe('PREVISIONNEL')
  })

  it('refuse un mois dont le CRA est validé, sans rien écrire', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    const r = await applyCellState({ userId, lineId: ligneJour, date: '2026-03-05', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })
    expect(await saisiesDu(ligneJour, '2026-03-05')).toEqual([])
  })

  it('ne détruit pas la case existante quand le mois se verrouille', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-06', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-06', kind: 'REALISE', state: { kind: 'VIDE' } })
    expect(await saisiesDu(ligneJour, '2026-03-06')).toHaveLength(1)
  })

  it('refuse en mode BLOCAGE et laisse la case intacte', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-09', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await applyCellState({ userId, lineId: ligneNuit, date: '2026-03-09', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r).toEqual({ ok: false, reason: 'CAPACITE', totalMinutes: 960, capacityMinutes: 480 })
    expect(await saisiesDu(ligneNuit, '2026-03-09')).toEqual([])
  })

  it('signale sans bloquer en mode AVERTISSEMENT', async () => {
    await updateSettings({ capacityMode: 'AVERTISSEMENT', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-10', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await applyCellState({ userId, lineId: ligneNuit, date: '2026-03-10', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r.ok).toBe(true)
    expect(r.ok && r.warning).toEqual({ totalMinutes: 960, capacityMinutes: 480 })
    expect(await saisiesDu(ligneNuit, '2026-03-10')).toHaveLength(1)
  })

  // La case qu'on remplace ne doit jamais se compter elle-même : corriger une
  // journée en demi-journée ferait sinon 1,5 j et se ferait refuser.
  it('ne compte pas la case remplacée dans le total du jour', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-11', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-11', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })
    expect(r.ok).toBe(true)
  })

  // Lot 0 : `allowedSlotIds` devient enfin applicable. Un créneau non autorisé
  // déclenche un signalement, pas un refus.
  it('signale un créneau non autorisé sans refuser la saisie', async () => {
    const r = await applyCellState({
      userId, lineId: ligneNuit, date: '2026-03-12', kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 180, slotId: 'nuit', eclatee: false },
    })

    expect(r.ok).toBe(true)
    expect(r.ok && r.signalement).toContain('Nuit')
    expect(await saisiesDu(ligneNuit, '2026-03-12')).toEqual([
      { minutes: 180, slotId: 'nuit', kind: 'REALISE', minutesParJour: 480, userId },
    ])
  })

  it('ne signale rien quand la prestation ne restreint aucun créneau', async () => {
    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-13', kind: 'REALISE',
      state: { kind: 'LIBRE', minutes: 180, slotId: 'nuit', eclatee: false },
    })
    expect(r.ok && r.signalement).toBeUndefined()
  })

  it('refuse un créneau inconnu des réglages', async () => {
    const r = await applyCellState({
      userId, lineId: ligneJour, date: '2026-03-16', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'inexistant' },
    })
    expect(r).toEqual({ ok: false, reason: 'SAISIE_INVALIDE' })
  })

  it('refuse une durée libre aberrante venue du client', async () => {
    for (const minutes of [0, -30, 1441, 12.5]) {
      const r = await applyCellState({
        userId, lineId: ligneJour, date: '2026-03-17', kind: 'REALISE',
        state: { kind: 'LIBRE', minutes, slotId: '', eclatee: false },
      })
      expect(r).toEqual({ ok: false, reason: 'SAISIE_INVALIDE' })
    }
    expect(await saisiesDu(ligneJour, '2026-03-17')).toEqual([])
  })

  it('refuse une prestation à laquelle l utilisateur n est pas affecté', async () => {
    const r = await applyCellState({ userId, lineId: ligneAutre, date: '2026-03-18', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    expect(r).toEqual({ ok: false, reason: 'NON_AFFECTE' })
  })

  // Même prestation, même jour, deux utilisateurs : c'est là que le scope se
  // vérifie vraiment, une suppression par (lineId, date) sans userId emporterait
  // la saisie du voisin.
  it('n efface jamais la case d un autre utilisateur sur la même prestation', async () => {
    await prisma.timeEntry.create({
      data: {
        lineId: ligneJour, userId: autreId, date: new Date('2026-03-19T00:00:00.000Z'),
        minutes: 480, kind: 'REALISE', minutesParJour: 480, slotId: '',
      },
    })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-19', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-19', kind: 'REALISE', state: { kind: 'VIDE' } })

    const restantes = await saisiesDu(ligneJour, '2026-03-19')
    expect(restantes).toHaveLength(1)
    expect(restantes[0]!.userId).toBe(autreId)
  })

  it('rend la case relisible par getMonthEntries', async () => {
    await applyCellState({ userId, lineId: ligneJour, date: '2026-03-20', kind: 'REALISE', state: { kind: 'DEMI', slotId: 'apres-midi' } })
    const entries = await getMonthEntries(userId, '2026-03')
    expect(entries).toContainEqual(
      expect.objectContaining({ date: '2026-03-20', minutes: 240, slotId: 'apres-midi' }),
    )
  })
})

describe('isMonthLocked', () => {
  it('rend faux sans CRA', async () => {
    expect(await isMonthLocked(userId, ligneJour, '2026-03')).toBe(false)
  })

  it('rend faux sur un CRA en brouillon', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'BROUILLON' },
    })
    expect(await isMonthLocked(userId, ligneJour, '2026-03')).toBe(false)
  })

  it('rend vrai sur un CRA validé', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })
    expect(await isMonthLocked(userId, ligneJour, '2026-03')).toBe(true)
  })

  it('ne voit pas le verrou d un autre mois', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })
    expect(await isMonthLocked(userId, ligneJour, '2026-04')).toBe(false)
  })
})
