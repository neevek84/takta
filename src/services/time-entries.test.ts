import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { resolveMinutesParJour } from '@/core/rates/cascade'
import { updateSettings } from './settings'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { saveEntry, getMonthEntries, getLineEngagementTotals } from './time-entries'
import {
  listPastForecast,
  convertPastForecast,
  getPastForecastWithLockStatus,
} from './time-entries'

let userId = ''
let intrusId = ''
let lineA = ''
let lineB = ''
/** Sur une **seconde** mission : le verrou porte sur un couple (mission, mois). */
let lineC = ''

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

  const m2 = await createMission({ clientId: c.id, label: 'M2' })
  lineC = (await createLine({ missionId: m2.id, userId, label: 'C', soldCentiemes: 3000, tjmCents: 0 })).id
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
    // Toutes les saisies partagent le même facteur (settings inchangés) : un
    // seul groupe par kind.
    expect(totals[lineA]).toEqual(
      expect.arrayContaining([
        { kind: 'REALISE', minutes: 1440, minutesParJour: 480 },
        { kind: 'PREVISIONNEL', minutes: 240, minutesParJour: 480 },
      ]),
    )
    expect(totals[lineA]).toHaveLength(2)
  })

  it('sépare les lignes et renvoie un tableau vide pour une ligne sans saisie', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'REALISE' })

    const totals = await getLineEngagementTotals(userId, [lineA, lineB])
    expect(totals[lineA]).toEqual([{ kind: 'REALISE', minutes: 480, minutesParJour: 480 }])
    expect(totals[lineB]).toEqual([])
  })

  it('scope par utilisateur', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'REALISE' })

    const totals = await getLineEngagementTotals(intrusId, [lineA])
    expect(totals[lineA]).toEqual([])
  })

  it('accepte une liste de lignes vide sans requête', async () => {
    expect(await getLineEngagementTotals(userId, [])).toEqual({})
  })

  // Le trou du lot 1d comblé par cette tâche : une saisie porte son facteur de
  // conversion figé à l'écriture, et un changement de réglage entre deux
  // saisies ne doit fusionner ni réinterpréter aucune des deux — elles
  // ressortent en groupes séparés, chacun avec son propre `minutesParJour`.
  it('ventile les saisies par facteur de conversion figé, sans les fusionner', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'REALISE' })
    await updateSettings({ minutesParJour: 420 })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-11', minutes: 420, kind: 'REALISE' })

    const totals = await getLineEngagementTotals(userId, [lineA])
    expect(totals[lineA]).toEqual(
      expect.arrayContaining([
        { kind: 'REALISE', minutes: 480, minutesParJour: 480 },
        { kind: 'REALISE', minutes: 420, minutesParJour: 420 },
      ]),
    )
    expect(totals[lineA]).toHaveLength(2)
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

/**
 * Les deux chiffres de l'encart de la page de saisie — jours prévisionnels
 * échus et nombre d'entre eux verrouillés — viennent d'ici, et non d'un calcul
 * refait dans la page à partir de `prisma` et d'un `status: 'VALIDE'` en dur.
 */
describe('getPastForecastWithLockStatus', () => {
  it('rend le prévisionnel échu du mois, sans le futur ni le réalisé', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 480, kind: 'PREVISIONNEL' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-20', minutes: 480, kind: 'PREVISIONNEL' })
    await saveEntry({ userId, lineId: lineB, date: '2026-03-05', minutes: 240, kind: 'REALISE' })

    const status = await getPastForecastWithLockStatus(userId, '2026-03', '2026-03-15')
    expect(status.entries.map((e) => e.date)).toEqual(['2026-03-10'])
    expect(status.lockedCount).toBe(0)
  })

  it('compte les jours dont la mission est verrouillée, sans compter les autres', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 240, kind: 'PREVISIONNEL' })
    await saveEntry({ userId, lineId: lineC, date: '2026-03-11', minutes: 240, kind: 'PREVISIONNEL' })

    const line = await prisma.missionLine.findUniqueOrThrow({ where: { id: lineA } })
    await prisma.cra.create({
      data: {
        missionId: line.missionId,
        userId,
        month: new Date('2026-03-01T00:00:00Z'),
        status: 'VALIDE',
      },
    })

    const status = await getPastForecastWithLockStatus(userId, '2026-03', '2026-03-15')
    expect(status.entries).toHaveLength(2)
    expect(status.lockedCount).toBe(1)

    await prisma.cra.deleteMany({ where: { userId } })
  })

  // Le compteur de l'encart et le comportement du bouton doivent rester
  // solidaires : ils s'évaluent tous deux par `isLocked`, sur le même partage.
  it("annonce exactement ce que la conversion réalise", async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 240, kind: 'PREVISIONNEL' })
    await saveEntry({ userId, lineId: lineC, date: '2026-03-11', minutes: 240, kind: 'PREVISIONNEL' })

    const line = await prisma.missionLine.findUniqueOrThrow({ where: { id: lineA } })
    await prisma.cra.create({
      data: {
        missionId: line.missionId,
        userId,
        month: new Date('2026-03-01T00:00:00Z'),
        status: 'VALIDE',
      },
    })

    const status = await getPastForecastWithLockStatus(userId, '2026-03', '2026-03-15')
    const conversion = await convertPastForecast(userId, '2026-03', '2026-03-15')

    expect(conversion.converted).toBe(status.entries.length - status.lockedCount)
    expect(conversion.skippedLocked).toBe(status.lockedCount)

    await prisma.cra.deleteMany({ where: { userId } })
  })

  it('scope par utilisateur', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-10', minutes: 240, kind: 'PREVISIONNEL' })

    const status = await getPastForecastWithLockStatus(intrusId, '2026-03', '2026-03-15')
    expect(status).toEqual({ entries: [], lockedCount: 0 })
  })
})

describe('gel du facteur de conversion', () => {
  it('fige le facteur effectif au moment de l écriture', async () => {
    await updateSettings({ minutesParJour: 480 })
    await saveEntry({ userId, lineId: lineA, date: '2026-06-01', minutes: 480, kind: 'REALISE' })

    const avant = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: lineA, date: new Date('2026-06-01T00:00:00.000Z') },
    })
    expect(avant.minutesParJour).toBe(480)
  })

  it('n écrit jamais le défaut du schéma quand le réglage vaut autre chose', async () => {
    // Si le chemin d'écriture oubliait de renseigner la colonne, ce test
    // verrait 480 — le défaut du schéma — au lieu de 420.
    await updateSettings({ minutesParJour: 420 })
    await saveEntry({ userId, lineId: lineA, date: '2026-06-02', minutes: 420, kind: 'REALISE' })

    const e = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: lineA, date: new Date('2026-06-02T00:00:00.000Z') },
    })
    expect(e.minutesParJour).toBe(420)
  })

  it('ne réécrit jamais une saisie existante quand le réglage change', async () => {
    await updateSettings({ minutesParJour: 480 })
    await saveEntry({ userId, lineId: lineA, date: '2026-06-03', minutes: 480, kind: 'REALISE' })

    await updateSettings({ minutesParJour: 420 })

    const e = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: lineA, date: new Date('2026-06-03T00:00:00.000Z') },
    })
    expect(e.minutesParJour).toBe(480)
  })

  it('laisse coexister deux facteurs dans le même mois', async () => {
    await updateSettings({ minutesParJour: 480 })
    await saveEntry({ userId, lineId: lineA, date: '2026-06-04', minutes: 480, kind: 'REALISE' })
    await updateSettings({ minutesParJour: 420 })
    await saveEntry({ userId, lineId: lineB, date: '2026-06-05', minutes: 420, kind: 'REALISE' })

    const entries = await getMonthEntries(userId, '2026-06')
    const facteurs = entries.map((e) => e.minutesParJour).sort()
    expect(facteurs).toEqual([420, 480])
  })

  it('restitue le facteur dans MonthEntry', async () => {
    await updateSettings({ minutesParJour: 450 })
    await saveEntry({ userId, lineId: lineA, date: '2026-06-06', minutes: 450, kind: 'REALISE' })

    const entry = (await getMonthEntries(userId, '2026-06')).find((e) => e.date === '2026-06-06')
    expect(entry!.minutesParJour).toBe(450)
  })

  it('respecte une surcharge portée par le client', async () => {
    const line = await prisma.missionLine.findUniqueOrThrow({
      where: { id: lineA },
      select: { mission: { select: { clientId: true } } },
    })
    await prisma.client.update({
      where: { id: line.mission.clientId },
      data: { minutesParJour: 400 },
    })
    await updateSettings({ minutesParJour: 480 })

    await saveEntry({ userId, lineId: lineA, date: '2026-06-07', minutes: 400, kind: 'REALISE' })

    const e = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: lineA, date: new Date('2026-06-07T00:00:00.000Z') },
    })
    expect(e.minutesParJour).toBe(400)

    await prisma.client.update({
      where: { id: line.mission.clientId },
      data: { minutesParJour: null },
    })
  })
})
