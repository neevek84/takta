import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings, DEFAULT_SLOTS } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { applyCellState } from './cells'
import { getMonthEntries } from './time-entries'
import { fillMonth, clearMonth } from './month-fill'

let userId = ''
let missionId = ''
let ligneA = ''
let ligneB = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'fill@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('FILL client')
  const m = await createMission({ clientId: c.id, label: 'FILL mission' })
  missionId = m.id
  ligneA = (await createLine({ missionId, userId, label: 'A', soldCentiemes: 5000, tjmCents: 0 })).id
  ligneB = (await createLine({ missionId, userId, label: 'B', soldCentiemes: 5000, tjmCents: 0 })).id
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
  await prisma.user.deleteMany({ where: { email: 'fill@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'FILL client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('fillMonth', () => {
  // Mars 2026 commence un dimanche et compte 22 jours ouvrés sans férié.
  it('pose une journée sur chaque jour ouvré du mois', async () => {
    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 22, sautesCapacite: 0, dejaSaisis: 0, verrouille: false })

    const entries = await getMonthEntries(userId, '2026-03')
    expect(entries).toHaveLength(22)
    expect(entries.every((e) => e.minutes === 480 && e.slotId === '')).toBe(true)
  })

  it('laisse les week-ends et les fériés intacts', async () => {
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    const dates = (await getMonthEntries(userId, '2026-03')).map((e) => e.date)
    // 2026-03-01 est un dimanche, 2026-03-07 un samedi.
    expect(dates).not.toContain('2026-03-01')
    expect(dates).not.toContain('2026-03-07')
  })

  it('saute un férié réglé', async () => {
    await updateSettings({ holidays: ['2026-03-02'] })
    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r.poses).toBe(21)
    expect((await getMonthEntries(userId, '2026-03')).map((e) => e.date)).not.toContain('2026-03-02')
  })

  it('écrit le réalisé sur le passé et le prévisionnel sur le futur', async () => {
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-16' })
    const entries = await getMonthEntries(userId, '2026-03')
    const avant = entries.find((e) => e.date === '2026-03-13')
    const apres = entries.find((e) => e.date === '2026-03-17')
    expect(avant!.kind).toBe('REALISE')
    expect(apres!.kind).toBe('PREVISIONNEL')
  })

  // Verrouille la frontière elle-même : le test précédent ne couvre que
  // l'avant-veille et le surlendemain, jamais `today` pris pour lui-même.
  // Convention du projet (cf. listPastForecast, task-10) : `today` n'est pas
  // encore « passé », donc il se remplit en PREVISIONNEL comme le lendemain,
  // et seule la veille bascule en REALISE. Une mutation `>=` -> `>` sur cette
  // comparaison referait basculer `today` en REALISE sans qu'aucun autre test
  // ne le remarque.
  it('trace la frontière réalisé/prévisionnel exactement sur le jour today', async () => {
    // 2026-03-10, -11, -12 sont mardi/mercredi/jeudi : trois jours ouvrés
    // consécutifs, sans week-end ni férié entre eux.
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-11' })
    const entries = await getMonthEntries(userId, '2026-03')
    const veille = entries.find((e) => e.date === '2026-03-10')
    const jourMeme = entries.find((e) => e.date === '2026-03-11')
    const lendemain = entries.find((e) => e.date === '2026-03-12')

    expect(veille!.kind).toBe('REALISE')
    expect(jourMeme!.kind).toBe('PREVISIONNEL')
    expect(lendemain!.kind).toBe('PREVISIONNEL')
  })

  // Le test central de la spec : jamais d'écrasement silencieux.
  it('saute les jours sans capacité et le dit', async () => {
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await applyCellState({ userId, lineId: ligneB, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' } })
    await applyCellState({ userId, lineId: ligneB, date: '2026-03-03', kind: 'REALISE', state: { kind: 'JOURNEE' } })

    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 20, sautesCapacite: 2, dejaSaisis: 0, verrouille: false })

    // Les journées de l'autre prestation sont intactes.
    const surB = (await getMonthEntries(userId, '2026-03')).filter((e) => e.lineId === ligneB)
    expect(surB).toHaveLength(2)
    expect(surB.every((e) => e.minutes === 480)).toBe(true)
  })

  it('n écrase jamais une saisie déjà posée sur la prestation, et la compte', async () => {
    await applyCellState({
      userId, lineId: ligneA, date: '2026-03-02', kind: 'REALISE',
      state: { kind: 'DEMI', slotId: 'matin' },
    })

    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 21, sautesCapacite: 0, dejaSaisis: 1, verrouille: false })

    const conservee = (await getMonthEntries(userId, '2026-03')).find(
      (e) => e.lineId === ligneA && e.date === '2026-03-02',
    )
    expect(conservee).toMatchObject({ minutes: 240, slotId: 'matin' })
  })

  it('refuse un mois verrouillé sans rien écrire', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: true })
    expect(await getMonthEntries(userId, '2026-03')).toHaveLength(0)
  })

  it('ne pose rien sur un mois sans jour ouvré réglé', async () => {
    await updateSettings({ workingDays: [] })
    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: false })
  })

  it('rejette une prestation non affectée plutôt que de rendre un compte rendu vide', async () => {
    const autre = await prisma.user.create({
      data: { email: 'fill-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    await expect(
      fillMonth({ userId: autre.id, lineId: ligneA, month: '2026-03', today: '2026-03-15' }),
    ).rejects.toThrow(/affect/i)
    await prisma.user.delete({ where: { id: autre.id } })
  })

  // I5 — la liste des jours « déjà saisis » qui fait sauter des jours doit
  // être scopée par userId : sans ce scope, une journée déjà posée par un
  // autre utilisateur affecté à la même prestation serait sautée pour ce
  // premier utilisateur alors qu'il n'a lui-même rien saisi ce jour-là, et
  // le bouton annoncerait un remplissage complet en laissant un trou.
  it('ne saute pas un jour déjà saisi par un autre utilisateur affecté à la même prestation', async () => {
    const autre = await prisma.user.create({
      data: { email: 'fill-scope-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    await prisma.assignment.create({ data: { lineId: ligneA, userId: autre.id, soldCentiemes: 0 } })
    await applyCellState({
      userId: autre.id, lineId: ligneA, date: '2026-03-02', kind: 'REALISE', state: { kind: 'JOURNEE' },
    })

    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 22, sautesCapacite: 0, dejaSaisis: 0, verrouille: false })

    const poseesParUserId = (await getMonthEntries(userId, '2026-03')).filter((e) => e.lineId === ligneA)
    expect(poseesParUserId).toHaveLength(22)
    expect(poseesParUserId.find((e) => e.date === '2026-03-02')).toBeDefined()

    await prisma.assignment.deleteMany({ where: { lineId: ligneA, userId: autre.id } })
    await prisma.user.delete({ where: { id: autre.id } })
  })

  // M8 — le verrou vérifié avant la boucle est redondant avec celui
  // qu'applyCellState refait à chaque itération ; les deux se recouvrent
  // dès qu'il existe au moins un jour ouvré. La seule situation où ce n'est
  // *pas* le cas — celle qui rend ce garde-fou pré-boucle réellement utile —
  // est un mois sans aucun jour ouvré réglé : la boucle ne s'exécute jamais,
  // et sans ce garde-fou le verrou du CRA ne serait jamais détecté.
  it('signale le verrou même sur un mois sans aucun jour ouvré réglé', async () => {
    await updateSettings({ workingDays: [] })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    const r = await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    expect(r).toEqual({ poses: 0, sautesCapacite: 0, dejaSaisis: 0, verrouille: true })
  })
})

describe('clearMonth', () => {
  it('retire les saisies du mois pour la seule prestation sélectionnée', async () => {
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    await applyCellState({ userId, lineId: ligneB, date: '2026-03-02', kind: 'REALISE', state: { kind: 'DEMI', slotId: 'matin' } })

    const r = await clearMonth({ userId, lineId: ligneA, month: '2026-03' })
    expect(r).toEqual({ supprimees: 22, verrouille: false })

    const restantes = await getMonthEntries(userId, '2026-03')
    expect(restantes).toHaveLength(1)
    expect(restantes[0]!.lineId).toBe(ligneB)
  })

  it('ne touche pas aux autres mois', async () => {
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    await fillMonth({ userId, lineId: ligneA, month: '2026-04', today: '2026-03-15' })

    await clearMonth({ userId, lineId: ligneA, month: '2026-03' })
    expect((await getMonthEntries(userId, '2026-04')).length).toBeGreaterThan(0)
  })

  it('refuse un mois verrouillé sans rien retirer', async () => {
    await fillMonth({ userId, lineId: ligneA, month: '2026-03', today: '2026-03-15' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00.000Z'), status: 'VALIDE' },
    })

    const r = await clearMonth({ userId, lineId: ligneA, month: '2026-03' })
    expect(r).toEqual({ supprimees: 0, verrouille: true })
    expect(await getMonthEntries(userId, '2026-03')).toHaveLength(22)
  })

  it('ne touche pas aux saisies d un autre utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'clear-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    await prisma.timeEntry.create({
      data: {
        lineId: ligneA, userId: autre.id, date: new Date('2026-03-02T00:00:00.000Z'),
        minutes: 480, kind: 'REALISE', minutesParJour: 480,
      },
    })

    await clearMonth({ userId, lineId: ligneA, month: '2026-03' })
    expect(await prisma.timeEntry.count({ where: { userId: autre.id } })).toBe(1)

    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('rend zéro sur un mois déjà vide', async () => {
    expect(await clearMonth({ userId, lineId: ligneA, month: '2026-03' })).toEqual({
      supprimees: 0,
      verrouille: false,
    })
  })
})
