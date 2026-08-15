import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry, getMonthEntries, getLineEngagementTotals } from './time-entries'
import { listPastForecast, convertPastForecast } from './time-entries'

let userId = ''
let intrusId = ''
let lineA = ''
let lineB = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'entries@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id

  // Utilisateur existant mais affecté à aucune ligne.
  const other = await prisma.user.create({
    data: { email: 'intrus@test.local', name: 'I', passwordHash: 'x' },
  })
  intrusId = other.id

  const c = await createClient('ENTRIES client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  lineA = (await createLine({ missionId: m.id, userId, label: 'A', soldCentiemes: 3000, tjmCents: 0 })).id
  lineB = (await createLine({ missionId: m.id, userId, label: 'B', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, intrusId] } } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
})

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { in: ['entries@test.local', 'intrus@test.local'] } },
  })
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

  // I1 — le mode AVERTISSEMENT doit produire un signalement exploitable par
  // l'écran, sinon il est indiscernable de DESACTIVE.
  it('remonte un avertissement chiffré en mode AVERTISSEMENT', async () => {
    await updateSettings({ capacityMode: 'AVERTISSEMENT' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r).toEqual({
      ok: true,
      minutes: 240,
      warning: { totalMinutes: 720, capacityMinutes: 480 },
    })
  })

  it("n'attache aucun avertissement quand la capacité est respectée", async () => {
    await updateSettings({ capacityMode: 'AVERTISSEMENT' })
    const r = await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(r).toEqual({ ok: true, minutes: 240 })
  })

  it("n'attache aucun avertissement en mode DESACTIVE, même au-delà de la capacité", async () => {
    await updateSettings({ capacityMode: 'DESACTIVE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    expect(r).toEqual({ ok: true, minutes: 480 })
  })

  // I6 — le scope par affectation vit dans le service, pas dans le server action.
  it("refuse la saisie d'un utilisateur non affecté à la ligne", async () => {
    const r = await saveEntry({ userId: intrusId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    expect(r).toEqual({ ok: false, reason: 'NON_AFFECTE' })
    expect(await prisma.timeEntry.count({ where: { userId: intrusId } })).toBe(0)
  })

  it("refuse aussi la suppression d'une saisie sur une ligne non affectée", async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    const r = await saveEntry({ userId: intrusId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })
    expect(r).toEqual({ ok: false, reason: 'NON_AFFECTE' })
    expect(await getMonthEntries(userId, '2026-03')).toHaveLength(1)
  })
})

// C3 — l'engagement est un cumul sur toute la durée de la ligne, jamais sur le
// seul mois affiché.
describe('getLineEngagementTotals', () => {
  it('cumule les saisies de tous les mois, pas seulement du mois courant', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-11', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-04-13', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-04-14', minutes: 240, kind: 'PREVISIONNEL' })

    const totals = await getLineEngagementTotals(userId, [lineA])
    expect(totals[lineA]).toEqual({ realiseMinutes: 1440, prevuMinutes: 240 })
  })

  it('sépare les lignes et renvoie zéro pour une ligne sans saisie', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'REALISE' })

    const totals = await getLineEngagementTotals(userId, [lineA, lineB])
    expect(totals[lineA]).toEqual({ realiseMinutes: 480, prevuMinutes: 0 })
    expect(totals[lineB]).toEqual({ realiseMinutes: 0, prevuMinutes: 0 })
  })

  it('scope par utilisateur', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'REALISE' })

    const totals = await getLineEngagementTotals(intrusId, [lineA])
    expect(totals[lineA]).toEqual({ realiseMinutes: 0, prevuMinutes: 0 })
  })

  it('accepte une liste de lignes vide sans requête', async () => {
    expect(await getLineEngagementTotals(userId, [])).toEqual({})
  })
})

describe('conversion du prévisionnel échu', () => {
  it('ne retient que le prévisionnel strictement passé', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'PREVISIONNEL' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-20', minutes: 480, kind: 'PREVISIONNEL' })
    await saveEntry({ userId, lineId: lineB, date: '2026-03-05', minutes: 240, kind: 'REALISE' })

    const past = await listPastForecast(userId, '2026-03', '2026-03-15')
    expect(past.map((e) => e.date)).toEqual(['2026-03-10'])
  })

  it('exclut le jour même', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-15', minutes: 480, kind: 'PREVISIONNEL' })
    expect(await listPastForecast(userId, '2026-03', '2026-03-15')).toHaveLength(0)
  })

  it('convertit le passé et laisse le futur intact', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'PREVISIONNEL' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-20', minutes: 480, kind: 'PREVISIONNEL' })

    const r = await convertPastForecast(userId, '2026-03', '2026-03-15')
    expect(r).toEqual({ converted: 1, skippedLocked: 0 })

    const entries = await getMonthEntries(userId, '2026-03')
    const byDate = new Map(entries.map((e) => [e.date, e.kind]))
    expect(byDate.get('2026-03-10')).toBe('REALISE')
    expect(byDate.get('2026-03-20')).toBe('PREVISIONNEL')
  })

  it('ne modifie jamais les minutes', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 240, kind: 'PREVISIONNEL' })
    await convertPastForecast(userId, '2026-03', '2026-03-15')

    const entry = (await getMonthEntries(userId, '2026-03')).find((e) => e.date === '2026-03-10')
    expect(entry!.minutes).toBe(240)
  })

  it('saute une mission dont le CRA est validé, sans toucher aux autres', async () => {
    const line = await prisma.missionLine.findUniqueOrThrow({ where: { id: lineA } })
    await prisma.cra.create({
      data: {
        missionId: line.missionId,
        userId,
        month: new Date('2026-03-01T00:00:00Z'),
        status: 'VALIDE',
      },
    })

    // lineA et lineB appartiennent à la même mission dans ce fichier de test :
    // les deux entrées sont donc sautées.
    await prisma.timeEntry.create({
      data: { lineId: lineA, userId, date: new Date('2026-03-10T00:00:00Z'), minutes: 480, kind: 'PREVISIONNEL' },
    })

    const r = await convertPastForecast(userId, '2026-03', '2026-03-15')
    expect(r.converted).toBe(0)
    expect(r.skippedLocked).toBe(1)

    const entry = (await getMonthEntries(userId, '2026-03')).find((e) => e.date === '2026-03-10')
    expect(entry!.kind).toBe('PREVISIONNEL')

    await prisma.cra.deleteMany({ where: { userId } })
  })

  it('ne touche pas au prévisionnel d un autre utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-conv@test.local', name: 'A', passwordHash: 'x' },
    })
    await prisma.timeEntry.create({
      data: { lineId: lineA, userId: autre.id, date: new Date('2026-03-10T00:00:00Z'), minutes: 480, kind: 'PREVISIONNEL' },
    })

    const r = await convertPastForecast(userId, '2026-03', '2026-03-15')
    expect(r.converted).toBe(0)

    const restant = await prisma.timeEntry.findFirst({ where: { userId: autre.id } })
    expect(restant!.kind).toBe('PREVISIONNEL')

    await prisma.user.delete({ where: { id: autre.id } })
  })
})
