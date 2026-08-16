import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient, listClients } from './clients'
import {
  createMission,
  createLine,
  listActiveLines,
  listMissionsForUser,
  updateMissionSignataire,
} from './missions'
import { updateSettings } from './settings'
import { readAuditSince } from './audit'

let userId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'missions@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
})

afterAll(async () => {
  await prisma.user.deleteMany({
    where: {
      email: {
        in: [
          'missions@test.local',
          'autre@test.local',
          'isolation-missions@test.local',
          'isolation-clients@test.local',
          'bootstrap@test.local',
        ],
      },
    },
  })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'ACME' } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'SURCHARGE' } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'CASCADE' } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'SIGNATAIRE' } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'JOURNAL' } } })
  await prisma.$disconnect()
})

describe('clients et missions', () => {
  it('crée un client et le retrouve', async () => {
    const c = await createClient('ACME 38')
    expect(c.id).toBeTruthy()
    expect((await listClients(userId)).some((x) => x.id === c.id)).toBe(true)
  })

  it('crée une ligne et son affectation automatiquement', async () => {
    const c = await createClient('ACME auto')
    const m = await createMission({ clientId: c.id, label: 'ITSM' })
    const l = await createLine({
      missionId: m.id,
      userId,
      label: 'Consultant ITSM',
      soldCentiemes: 3000,
      tjmCents: 80000,
    })

    const assignment = await prisma.assignment.findUnique({
      where: { lineId_userId: { lineId: l.id, userId } },
    })
    expect(assignment).not.toBeNull()
    expect(assignment!.soldCentiemes).toBe(3000)
  })

  // Défaut observé en usage réel : la ligne était créée, puis l'affectation
  // échouait (`Foreign key constraint violated`), laissant une ligne orpheline
  // — invisible dans l'interface, puisque `listActiveLines` exige une
  // affectation, et impossible à supprimer.
  it("ne laisse aucune ligne orpheline quand l'affectation échoue", async () => {
    const c = await createClient('ACME transaction')
    const m = await createMission({ clientId: c.id, label: 'Transaction' })

    await expect(
      createLine({
        missionId: m.id,
        userId: 'utilisateur-inexistant',
        label: 'Orpheline',
        soldCentiemes: 100,
        tjmCents: 0,
      }),
    ).rejects.toThrow()

    expect(await prisma.missionLine.count({ where: { missionId: m.id } })).toBe(0)
  })

  it('porte deux lignes tarifées différemment sous une même mission', async () => {
    const c = await createClient('ACME deux lignes')
    const m = await createMission({ clientId: c.id, label: 'ITSM deux lignes' })
    await createLine({ missionId: m.id, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000 })
    await createLine({ missionId: m.id, userId, label: 'Nuit', soldCentiemes: 1000, tjmCents: 120000 })

    const lines = (await listActiveLines(userId)).filter((l) => l.missionLabel === 'ITSM deux lignes')
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.label).sort()).toEqual(['Jour', 'Nuit'])
  })

  it('hérite de minutesParJour des réglages quand la ligne ne le surcharge pas', async () => {
    const c = await createClient('ACME herit')
    const m = await createMission({ clientId: c.id, label: 'H' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const line = (await listActiveLines(userId)).find((l) => l.missionLabel === 'H')
    expect(line!.minutesParJour).toBe(480)
  })

  it('respecte la surcharge de minutesParJour au niveau de la ligne', async () => {
    const c = await createClient('ACME surcharge')
    const m = await createMission({ clientId: c.id, label: 'S' })
    await createLine({
      missionId: m.id,
      userId,
      label: 'L',
      soldCentiemes: 100,
      tjmCents: 0,
      minutesParJour: 432,
    })

    const line = (await listActiveLines(userId)).find((l) => l.missionLabel === 'S')
    expect(line!.minutesParJour).toBe(432)
  })

  it('ne renvoie que les lignes affectées à l utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre@test.local', name: 'A', passwordHash: 'x' },
    })
    const lines = await listActiveLines(autre.id)
    expect(lines).toHaveLength(0)
    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('ne montre une mission revendiquée qu à l utilisateur affecté, jamais à un autre', async () => {
    const c = await createClient('ACME isolation missions')
    const m = await createMission({ clientId: c.id, label: 'Isolation missions' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const autre = await prisma.user.create({
      data: { email: 'isolation-missions@test.local', name: 'I', passwordHash: 'x' },
    })

    const pourProprietaire = await listMissionsForUser(userId)
    expect(pourProprietaire.some((x) => x.id === m.id)).toBe(true)

    const pourAutre = await listMissionsForUser(autre.id)
    expect(pourAutre.some((x) => x.id === m.id)).toBe(false)

    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('cache un client dont toutes les missions sont affectées à un autre utilisateur', async () => {
    const c = await createClient('ACME isolation clients')
    const m = await createMission({ clientId: c.id, label: 'Isolation clients' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const autre = await prisma.user.create({
      data: { email: 'isolation-clients@test.local', name: 'I', passwordHash: 'x' },
    })

    expect((await listClients(userId)).some((x) => x.id === c.id)).toBe(true)
    expect((await listClients(autre.id)).some((x) => x.id === c.id)).toBe(false)

    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('garde un client et une mission fraîchement créés visibles avant toute affectation (base à froid)', async () => {
    const c = await createClient('ACME bootstrap')
    const m = await createMission({ clientId: c.id, label: 'Bootstrap' })

    const autre = await prisma.user.create({
      data: { email: 'bootstrap@test.local', name: 'B', passwordHash: 'x' },
    })

    expect((await listClients(autre.id)).some((x) => x.id === c.id)).toBe(true)
    expect((await listMissionsForUser(autre.id)).some((x) => x.id === m.id)).toBe(true)

    await prisma.user.delete({ where: { id: autre.id } })
  })
})

describe('surcharges de durée de journée', () => {
  it('crée un client avec sa surcharge', async () => {
    const c = await createClient('SURCHARGE client', 420)
    const relu = await prisma.client.findUniqueOrThrow({ where: { id: c.id } })
    expect(relu.minutesParJour).toBe(420)
  })

  it('crée un client sans surcharge par défaut', async () => {
    const c = await createClient('SURCHARGE sans')
    const relu = await prisma.client.findUniqueOrThrow({ where: { id: c.id } })
    expect(relu.minutesParJour).toBeNull()
  })

  it('crée une mission avec sa surcharge', async () => {
    const c = await createClient('SURCHARGE mission')
    const m = await createMission({ clientId: c.id, label: 'M', minutesParJour: 450 })
    const relu = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })
    expect(relu.minutesParJour).toBe(450)
  })

  it('expose la valeur effective et la surcharge propre de la mission', async () => {
    await updateSettings({ minutesParJour: 480 })
    const c = await createClient('SURCHARGE effectif', 420)
    const m = await createMission({ clientId: c.id, label: 'ME' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'ME')
    // Héritée du client, pas surchargée sur la mission.
    expect(mission!.minutesParJourEffectif).toBe(420)
    expect(mission!.minutesParJourSurcharge).toBeNull()
  })

  it('la surcharge de mission l emporte sur celle du client', async () => {
    await updateSettings({ minutesParJour: 480 })
    const c = await createClient('SURCHARGE priorite', 420)
    const m = await createMission({ clientId: c.id, label: 'MP', minutesParJour: 450 })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'MP')
    expect(mission!.minutesParJourEffectif).toBe(450)
    expect(mission!.minutesParJourSurcharge).toBe(450)
  })
})

describe('LineForGrid et la cascade du facteur', () => {
  it('applique la surcharge du client à la prestation affichée', async () => {
    await updateSettings({ minutesParJour: 480 })
    const c = await createClient('CASCADE client', 420)
    const m = await createMission({ clientId: c.id, label: 'CASCADE mission' })
    const l = await createLine({ missionId: m.id, userId, label: 'CASCADE ligne', soldCentiemes: 100, tjmCents: 0 })

    const ligne = (await listActiveLines(userId)).find((x) => x.id === l.id)
    // Sans la cascade, la ligne afficherait 480 alors que l'écriture fige 420.
    expect(ligne!.minutesParJour).toBe(420)
  })

  it('laisse la surcharge de la prestation l emporter sur celle du client', async () => {
    await updateSettings({ minutesParJour: 480 })
    const c = await createClient('CASCADE priorite', 420)
    const m = await createMission({ clientId: c.id, label: 'CASCADE mission 2' })
    const l = await createLine({
      missionId: m.id, userId, label: 'CASCADE ligne 2', soldCentiemes: 100, tjmCents: 0,
      minutesParJour: 400,
    })

    const ligne = (await listActiveLines(userId)).find((x) => x.id === l.id)
    expect(ligne!.minutesParJour).toBe(400)
  })
})

describe('signataire de la mission', () => {
  it('est vide à la création', async () => {
    const c = await createClient('SIGNATAIRE vide')
    const m = await createMission({ clientId: c.id, label: 'MV' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'MV')
    expect(mission!.signataireNom).toBe('')
    expect(mission!.signataireEmail).toBe('')
  })

  it('se renseigne à la création', async () => {
    const c = await createClient('SIGNATAIRE creation')
    const m = await createMission({
      clientId: c.id,
      label: 'MC',
      signataireNom: 'Claire Martin',
      signataireEmail: 'claire@acme.test',
    })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'MC')
    expect(mission!.signataireNom).toBe('Claire Martin')
    expect(mission!.signataireEmail).toBe('claire@acme.test')
  })

  it('se modifie après coup', async () => {
    const c = await createClient('SIGNATAIRE maj')
    const m = await createMission({ clientId: c.id, label: 'MM' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const r = await updateMissionSignataire(userId, m.id, {
      nom: 'Paul Durand',
      email: 'paul@acme.test',
    })
    expect(r).toEqual({ ok: true })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'MM')
    expect(mission!.signataireNom).toBe('Paul Durand')
    expect(mission!.signataireEmail).toBe('paul@acme.test')
  })

  it('deux missions du même client portent deux interlocuteurs différents', async () => {
    // La raison d être de la décision : le signataire n est pas une propriété
    // du client.
    const c = await createClient('SIGNATAIRE deux missions')
    const a = await createMission({
      clientId: c.id,
      label: 'MA',
      signataireNom: 'Chef de projet',
      signataireEmail: 'cp@acme.test',
    })
    const b = await createMission({
      clientId: c.id,
      label: 'MB',
      signataireNom: 'Responsable de service',
      signataireEmail: 'rs@acme.test',
    })
    await createLine({ missionId: a.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })
    await createLine({ missionId: b.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const missions = await listMissionsForUser(userId)
    expect(missions.find((x) => x.label === 'MA')!.signataireEmail).toBe('cp@acme.test')
    expect(missions.find((x) => x.label === 'MB')!.signataireEmail).toBe('rs@acme.test')
  })

  it('refuse une adresse électronique invalide', async () => {
    const c = await createClient('SIGNATAIRE email invalide')
    const m = await createMission({ clientId: c.id, label: 'MI' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const r = await updateMissionSignataire(userId, m.id, { nom: 'X', email: 'pas-une-adresse' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toContain('adresse')

    // Et rien n a été écrit : un refus qui laisse passer l écriture ne refuse rien.
    const relu = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })
    expect(relu.signataireEmail).toBe('')
  })

  it('accepte de tout effacer — le signataire n est pas obligatoire', async () => {
    const c = await createClient('SIGNATAIRE effacement')
    const m = await createMission({
      clientId: c.id,
      label: 'ME',
      signataireNom: 'X',
      signataireEmail: 'x@acme.test',
    })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    expect(await updateMissionSignataire(userId, m.id, { nom: '', email: '' })).toEqual({ ok: true })
    const relu = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })
    expect([relu.signataireNom, relu.signataireEmail]).toEqual(['', ''])
  })

  it('refuse un nom sans adresse — un destinataire sans adresse n est pas joignable', async () => {
    const c = await createClient('SIGNATAIRE sans email')
    const m = await createMission({ clientId: c.id, label: 'MS' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const r = await updateMissionSignataire(userId, m.id, { nom: 'Sans adresse', email: '' })
    expect(r.ok).toBe(false)
  })

  it('rogne les espaces plutôt que d enregistrer une adresse injoignable', async () => {
    const c = await createClient('SIGNATAIRE espaces')
    const m = await createMission({ clientId: c.id, label: 'MW' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    expect(
      await updateMissionSignataire(userId, m.id, {
        nom: '  Claire Martin  ',
        email: '  claire@acme.test  ',
      }),
    ).toEqual({ ok: true })

    const relu = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })
    expect(relu.signataireNom).toBe('Claire Martin')
    expect(relu.signataireEmail).toBe('claire@acme.test')
  })

  it('ne touche pas la mission d un utilisateur non affecté', async () => {
    const autre = await prisma.user.create({
      data: { email: 'signataire-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    const c = await createClient('SIGNATAIRE isolation')
    const m = await createMission({ clientId: c.id, label: 'MZ' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })

    const r = await updateMissionSignataire(autre.id, m.id, {
      nom: 'Intrus',
      email: 'intrus@acme.test',
    })
    expect(r.ok).toBe(false)

    const relu = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })
    expect(relu.signataireNom).toBe('')

    await prisma.user.delete({ where: { id: autre.id } })
  })
})

describe('consignation du référentiel', () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({})
  })

  it('consigne la création d un client', async () => {
    const c = await createClient('JOURNAL client', null, userId)
    const journal = await readAuditSince({ since: 0 })
    expect(journal[0]).toMatchObject({
      action: 'client.cree', entityType: 'Client', entityId: c.id, actorId: userId,
    })
    expect(journal[0]!.payload).toMatchObject({ name: 'JOURNAL client' })
  })

  it('consigne la création d une mission et d une prestation', async () => {
    const c = await createClient('JOURNAL cascade', null, userId)
    const m = await createMission({ clientId: c.id, label: 'M', userId })
    const l = await createLine({
      missionId: m.id, userId, label: 'L', soldCentiemes: 3000, tjmCents: 80000,
    })

    expect((await readAuditSince({ since: 0 })).map((e) => e.action)).toEqual([
      'client.cree', 'mission.creee', 'prestation.creee',
    ])
    const journal = await readAuditSince({ since: 0 })
    expect(journal[2]).toMatchObject({ entityType: 'MissionLine', entityId: l.id })
    expect(journal[2]!.payload).toMatchObject({ missionId: m.id, soldCentiemes: 3000 })
  })

  it('attribue au système un acte sans utilisateur', async () => {
    await createClient('JOURNAL systeme')
    expect((await readAuditSince({ since: 0 }))[0]).toMatchObject({
      actorId: '', actorLabel: 'SYSTEME',
    })
  })

  it('ne consigne aucune consultation du référentiel', async () => {
    await listMissionsForUser(userId)
    await listActiveLines(userId)
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })
})
