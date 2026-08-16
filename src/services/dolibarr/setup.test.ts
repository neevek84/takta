import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { updateSettings, getSettings } from '@/services/settings'
import { buildChargeMatrix } from '@/services/charge'
import { FakeDolibarr } from './fake'
import { DolibarrUnavailableError } from './api'
import { previewDolibarrSetup, applyDolibarrSetup } from './setup'

let userId = ''
let missionId = ''
let lineId = ''
let api: FakeDolibarr

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'setup@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('SETUP client')
  const m = await createMission({ clientId: c.id, label: 'SETUP mission' })
  missionId = m.id
  lineId = (
    await createLine({
      missionId,
      userId,
      label: 'Dev',
      soldCentiemes: 3000,
      tjmCents: 80_000,
    })
  ).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, debutExerciceMois: 1, capacityMode: 'DESACTIVE' })

  api = new FakeDolibarr()
  api.setup.SOCIETE_FISCAL_MONTH_START = '4'
  api.setup.TIMESHEET_DAY_DURATION = '7'
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'setup@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'SETUP client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('aperçu de la reprise', () => {
  it('signale l écart de durée de journée et ce qu il produira', async () => {
    const p = await previewDolibarrSetup({ userId, api, today: '2026-08-15' })

    expect(p.minutesParJour).toEqual({
      local: 480,
      dolibarr: 420,
      divergent: true,
      centiemesAffichesParDolibarr: 114,
    })
  })

  it('annonce les bornes du nouvel exercice avant confirmation', async () => {
    const p = await previewDolibarrSetup({ userId, api, today: '2026-08-15' })

    expect(p.debutExerciceMois).toEqual({ local: 1, dolibarr: 4, divergent: true })
    expect(p.exerciceApresReprise).toEqual({
      debut: '2026-04-01',
      fin: '2027-03-31',
      label: 'Exercice 2026-2027',
    })
  })

  it('compte les saisies concernées par le réétalonnage, avant tout changement', async () => {
    await saveEntry({ userId, lineId, date: '2026-07-01', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })

    const p = await previewDolibarrSetup({ userId, api, today: '2026-08-15' })
    expect(p.reetalonnage).toEqual({ concernees: 1, verrouillees: 1 })

    // Rien n'a été écrit : c'est un aperçu.
    expect((await getSettings()).minutesParJour).toBe(480)
  })

  it('ne propose rien quand les deux côtés sont déjà alignés', async () => {
    await updateSettings({ minutesParJour: 420, debutExerciceMois: 4 })
    const p = await previewDolibarrSetup({ userId, api, today: '2026-08-15' })

    expect(p.minutesParJour.divergent).toBe(false)
    expect(p.debutExerciceMois.divergent).toBe(false)
    expect(p.exerciceApresReprise).toBeNull()
  })

  it('reste utilisable quand une constante n est pas lisible', async () => {
    api.setup = {}
    const p = await previewDolibarrSetup({ userId, api, today: '2026-08-15' })

    expect(p.minutesParJour.dolibarr).toBeNull()
    expect(p.minutesParJour.divergent).toBe(false)
    expect(p.debutExerciceMois.dolibarr).toBeNull()
    expect(p.reetalonnage).toEqual({ concernees: 0, verrouillees: 0 })
  })

  it('remonte la panne au lieu de faire passer une instance éteinte pour alignée', async () => {
    // Une constante illisible parce que Dolibarr est éteint n'est pas une
    // constante absente : rendre `divergent: false` ferait afficher « déjà
    // aligné » à un écran qui n'a rien pu lire. L'appelant reçoit la panne, la
    // dit, et l'application continue.
    api.panne = true
    await expect(previewDolibarrSetup({ userId, api, today: '2026-08-15' })).rejects.toBeInstanceOf(
      DolibarrUnavailableError,
    )
  })
})

describe('application de la reprise', () => {
  it('NE TOUCHE JAMAIS une saisie d un mois validé', async () => {
    // Le test central du lot. Un document signé dont le contenu change après
    // signature est indéfendable.
    await saveEntry({ userId, lineId, date: '2026-07-01', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })

    const r = await applyDolibarrSetup({
      userId,
      api,
      reprendreExercice: false,
      reprendreDureeJournee: true,
      reetalonner: true,
    })
    expect(r.recalibrees).toBe(1)
    expect(r.sauteesVerrouillees).toBe(1)

    const juillet = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, date: new Date('2026-07-01T00:00:00.000Z') },
    })
    const aout = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, date: new Date('2026-08-03T00:00:00.000Z') },
    })
    expect(juillet.minutesParJour).toBe(480)
    expect(aout.minutesParJour).toBe(420)
  })

  it('rend exactement les mêmes chiffres pour un CRA validé, après la reprise', async () => {
    // Le défaut constaté par le porteur, vérifié sur des **chiffres lus**, pas
    // sur une colonne. Une saisie peut garder son facteur figé en base et voir
    // ses jours bouger quand même, si un lecteur recalcule à partir du réglage
    // courant au lieu de lire le facteur de la saisie. C'est ce qu'interdit ce
    // test : le plan de charge est relu de bout en bout, avant et après.
    await saveEntry({ userId, lineId, date: '2026-07-01', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-07-01T00:00:00Z'), status: 'VALIDE' },
    })

    const avant = await buildChargeMatrix(userId, 2026)
    const juilletAvant = avant.rows[0]!.cells[6]!
    const caJuilletAvant = avant.monthTotals[6]!.caCents
    expect(juilletAvant.realiseCentiemes).toBe(100)

    await applyDolibarrSetup({
      userId,
      api,
      reprendreExercice: false,
      reprendreDureeJournee: true,
      reetalonner: true,
    })

    const apres = await buildChargeMatrix(userId, 2026)
    expect(apres.rows[0]!.cells[6]).toEqual(juilletAvant)
    expect(apres.monthTotals[6]!.caCents).toBe(caJuilletAvant)

    // Et le mois ouvert, lui, a bien suivi le nouveau réglage — sans quoi le
    // test au-dessus passerait tout aussi bien si la reprise n'avait rien fait.
    expect(apres.rows[0]!.cells[7]!.realiseCentiemes).toBe(114)
  })

  it('reprend la durée de journée sans réétalonner si on ne le demande pas', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })

    const r = await applyDolibarrSetup({
      userId,
      api,
      reprendreExercice: false,
      reprendreDureeJournee: true,
      reetalonner: false,
    })
    expect(r.reglagesRepris).toEqual(["durée d'une journée"])
    expect(r.recalibrees).toBe(0)

    expect((await getSettings()).minutesParJour).toBe(420)
    const e = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
    expect(e.minutesParJour).toBe(480)
  })

  it('reprend le mois de début d exercice', async () => {
    const r = await applyDolibarrSetup({
      userId,
      api,
      reprendreExercice: true,
      reprendreDureeJournee: false,
      reetalonner: false,
    })
    expect(r.reglagesRepris).toEqual(["mois de début d'exercice"])
    expect((await getSettings()).debutExerciceMois).toBe(4)
    expect((await getSettings()).minutesParJour).toBe(480)
  })

  it('ne réétalonne rien quand la durée de journée n a pas été reprise', async () => {
    // Réétalonner sans avoir repris la durée alignerait les saisies sur un
    // réglage que l'utilisateur n'a pas changé — un effet de bord qu'il n'a
    // pas demandé, sur des mois ouverts qu'il croit stables.
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })
    await updateSettings({ minutesParJour: 420 })

    const r = await applyDolibarrSetup({
      userId,
      api,
      reprendreExercice: false,
      reprendreDureeJournee: false,
      reetalonner: true,
    })
    expect(r).toEqual({ reglagesRepris: [], recalibrees: 0, sauteesVerrouillees: 0 })

    const e = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
    expect(e.minutesParJour).toBe(480)
  })

  it('ne fait rien quand on ne reprend rien', async () => {
    const r = await applyDolibarrSetup({
      userId,
      api,
      reprendreExercice: false,
      reprendreDureeJournee: false,
      reetalonner: false,
    })
    expect(r).toEqual({ reglagesRepris: [], recalibrees: 0, sauteesVerrouillees: 0 })
    expect((await getSettings()).minutesParJour).toBe(480)
  })

  it('ignore une reprise dont la constante n est pas lisible', async () => {
    api.setup = {}
    const r = await applyDolibarrSetup({
      userId,
      api,
      reprendreExercice: true,
      reprendreDureeJournee: true,
      reetalonner: true,
    })
    expect(r.reglagesRepris).toEqual([])
    expect((await getSettings()).minutesParJour).toBe(480)
  })

  it('refuse une durée de journée que le réglage local n accepte pas', async () => {
    // Dolibarr n'interdit pas une journée d'une demi-heure ; le réglage local,
    // si. Une reprise silencieusement tronquée écrirait un facteur aberrant
    // sous lequel toute saisie future serait fausse.
    api.setup.TIMESHEET_DAY_DURATION = '0.5'

    await expect(
      applyDolibarrSetup({
        userId,
        api,
        reprendreExercice: false,
        reprendreDureeJournee: true,
        reetalonner: false,
      }),
    ).rejects.toThrow()
    expect((await getSettings()).minutesParJour).toBe(480)
  })
})
