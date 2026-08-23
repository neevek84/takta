import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient, listClients } from './clients'
import {
  createMission,
  createLine,
  listActiveLines,
  listMissionsForUser,
  updateMissionLabel,
  updateLine,
  updateMissionSignataire,
} from './missions'
import { updateSettings } from './settings'
import { readAuditSince } from './audit'
import { attachPropalLine } from './dolibarr/propal'
import { attachClient } from './dolibarr/import'
import { FakeDolibarr } from './dolibarr/fake'
import { DOLIBARR, DolibarrRequestError } from './dolibarr/api'
import { saveEntry, getLineEngagementTotals } from './time-entries'

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
  await prisma.client.deleteMany({ where: { name: { startsWith: 'PROPALE' } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'MANUEL' } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'AFFECTATION' } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'NON AFFECTE' } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'SOURCE' } } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'RENOMMAGE' } } })
  await prisma.$disconnect()
})

describe('clients et missions', () => {
  // `Mission.startDate` existait au schéma sans que rien ne l'écrive jamais.
  // C'est elle qui alimente `date_start` du projet Dolibarr.
  it('enregistre la date de démarrage saisie à la création', async () => {
    const c = await createClient('Avec date')
    const m = await createMission({ clientId: c.id, label: 'M', startDate: '2026-09-01' })

    const relue = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })
    expect(relue.startDate?.toISOString().slice(0, 10)).toBe('2026-09-01')
  })

  it('accepte une mission sans date de démarrage', async () => {
    const c = await createClient('Sans date')
    const m = await createMission({ clientId: c.id, label: 'M' })

    const relue = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })
    expect(relue.startDate).toBeNull()
  })

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

  it('dit d où viennent la mission et chacune de ses prestations', async () => {
    // Sans cette distinction, rien ne permettait de voir qu'une mission ou une
    // prestation ne pousserait jamais rien — on s'en apercevait au premier CRA
    // validé qui n'arrivait pas.
    const c = await createClient('ACME origine')
    const m = await createMission({ clientId: c.id, label: 'Origine' })
    const rattachee = await createLine({
      missionId: m.id,
      userId,
      label: 'Avec tâche',
      soldCentiemes: 100,
      tjmCents: 0,
    })
    const locale = await createLine({
      missionId: m.id,
      userId,
      label: 'Sans tâche',
      soldCentiemes: 100,
      tjmCents: 0,
    })

    const avant = (await listMissionsForUser(userId)).find((x) => x.id === m.id)
    expect(avant?.dolibarrProjectId).toBeNull()
    expect(avant?.lines.every((l) => l.dolibarrTaskId === null)).toBe(true)

    await prisma.externalLink.createMany({
      data: [
        {
          userId,
          entityType: 'Mission',
          entityId: m.id,
          provider: DOLIBARR,
          externalId: '46',
          syncState: 'SYNCED',
        },
        {
          userId,
          entityType: 'MissionLine',
          entityId: rattachee.id,
          provider: DOLIBARR,
          externalId: '51',
          syncState: 'SYNCED',
        },
      ],
    })

    const apres = (await listMissionsForUser(userId)).find((x) => x.id === m.id)
    expect(apres?.dolibarrProjectId).toBe(46)
    expect(apres?.lines.find((l) => l.id === rattachee.id)?.dolibarrTaskId).toBe(51)
    expect(apres?.lines.find((l) => l.id === locale.id)?.dolibarrTaskId).toBeNull()

    await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR, entityId: m.id } })
    await prisma.externalLink.deleteMany({
      where: { provider: DOLIBARR, entityId: rattachee.id },
    })
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

describe('engagement issu d une propale', () => {
  // La suite partage une seule base : un autre fichier a pu laisser d'autres
  // réglages derrière lui, et ces tests parlent de conversion.
  beforeEach(async () => {
    await updateSettings({
      minutesParJour: 480,
      defaultEngagementSource: 'MANUEL',
      capacityMode: 'AVERTISSEMENT',
    })
  })

  /**
   * Le décor minimal d'une reprise licite : un client local rattaché à un
   * tiers Dolibarr, une mission, une prestation, et une propale du **même**
   * tiers.
   */
  async function decor(args: {
    nom: string
    lignes?: Array<{ label: string; qty: number; subpriceCents: number }>
    minutesParJourClient?: number | null
    label?: string
  }) {
    const api = new FakeDolibarr()
    const tiers = api.seedThirdparty(args.nom)
    const c = await createClient(args.nom, args.minutesParJourClient ?? null)
    await attachClient({ userId, clientId: c.id, dolibarrThirdpartyId: tiers.id })
    const m = await createMission({ clientId: c.id, label: `${args.nom} mission` })
    const ligne = await createLine({
      missionId: m.id,
      userId,
      label: args.label ?? 'Dev',
      soldCentiemes: 0,
      tjmCents: 0,
    })
    const propale = api.seedProposal({
      ref: `PR-${args.nom}`,
      socid: tiers.id,
      lines: args.lignes ?? [{ label: 'Développement', qty: 30, subpriceCents: 80_000 }],
    })
    return { api, tiers, client: c, mission: m, ligne, propale }
  }

  it('reprend les jours vendus et le TJM depuis la ligne de propale', async () => {
    const d = await decor({ nom: 'PROPALE reprise' })

    const r = await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    })

    expect(r).toEqual({ soldCentiemes: 3000, tjmCents: 80_000 })
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.soldCentiemes).toBe(3000)
    expect(relue.tjmCents).toBe(80_000)
    expect(relue.engagementSource).toBe('DOLIBARR_PROPALE')

    const lien = await prisma.externalLink.findUniqueOrThrow({
      where: {
        entityType_entityId_provider: {
          entityType: 'MissionLinePropalLine',
          entityId: d.ligne.id,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien.externalId).toBe(`${d.propale.id}:${d.propale.lines[0]!.id}`)
    expect(lien.userId).toBe(userId)
  })

  it('reprend deux lignes de la même propale sous deux engagements distincts', async () => {
    // Le cas réel : « Consultant ITSM 30 j TJM 800 » et « Consultant ITSM Nuit
    // 10 j TJM 1200 » sur la même propale. Reprendre un total les confondrait.
    const d = await decor({
      nom: 'PROPALE deux lignes',
      lignes: [
        { label: 'Consultant ITSM', qty: 30, subpriceCents: 80_000 },
        { label: 'Consultant ITSM Nuit', qty: 10, subpriceCents: 120_000 },
      ],
    })
    const nuit = await createLine({
      missionId: d.mission.id,
      userId,
      label: 'Nuit',
      soldCentiemes: 0,
      tjmCents: 0,
    })

    await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    })
    await attachPropalLine({
      userId,
      lineId: nuit.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[1]!.id,
      api: d.api,
    })

    const jour = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    const relueNuit = await prisma.missionLine.findUniqueOrThrow({ where: { id: nuit.id } })
    expect([jour.soldCentiemes, jour.tjmCents]).toEqual([3000, 80_000])
    expect([relueNuit.soldCentiemes, relueNuit.tjmCents]).toEqual([1000, 120_000])
  })

  it('refuse la propale d un autre tiers — la facture partirait chez le mauvais client', async () => {
    const d = await decor({ nom: 'PROPALE tiers A' })
    const autreTiers = d.api.seedThirdparty('Tiers B')
    const propaleDeB = d.api.seedProposal({
      ref: 'PR-B',
      socid: autreTiers.id,
      lines: [{ label: 'Dev', qty: 30, subpriceCents: 80_000 }],
    })

    await expect(
      attachPropalLine({
        userId,
        lineId: d.ligne.id,
        proposalId: propaleDeB.id,
        propalLineId: propaleDeB.lines[0]!.id,
        api: d.api,
      }),
    ).rejects.toThrow(/PR-B.*tiers Dolibarr/s)

    // Et rien n'a été écrit : un refus qui laisse passer l'écriture ne refuse rien.
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.soldCentiemes).toBe(0)
    expect(relue.engagementSource).toBe('MANUEL')
    expect(
      await prisma.externalLink.count({
        where: { entityType: 'MissionLinePropalLine', entityId: d.ligne.id },
      }),
    ).toBe(0)
  })

  it('refuse la propale d un tiers quand le client local n est rattaché à aucun tiers', async () => {
    const api = new FakeDolibarr()
    const tiers = api.seedThirdparty('PROPALE orphelin tiers')
    const c = await createClient('PROPALE orphelin')
    const m = await createMission({ clientId: c.id, label: 'M' })
    const ligne = await createLine({
      missionId: m.id,
      userId,
      label: 'Dev',
      soldCentiemes: 0,
      tjmCents: 0,
    })
    const propale = api.seedProposal({
      ref: 'PR-ORPHELIN',
      socid: tiers.id,
      lines: [{ label: 'Dev', qty: 30, subpriceCents: 80_000 }],
    })

    await expect(
      attachPropalLine({
        userId,
        lineId: ligne.id,
        proposalId: propale.id,
        propalLineId: propale.lines[0]!.id,
        api,
      }),
    ).rejects.toThrow(/Rattachez d'abord/)

    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(relue.engagementSource).toBe('MANUEL')
  })

  it('ne convertit pas les jours vendus avec la durée d une journée', async () => {
    // Une propale vend des JOURS. Les repasser par le facteur de conversion
    // (480 min globales contre 420 côté client) donnerait 2625 centièmes au
    // lieu de 3000, et l'engagement affiché mentirait de trois jours et demi.
    const d = await decor({ nom: 'PROPALE facteur', minutesParJourClient: 420 })

    const r = await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    })
    expect(r.soldCentiemes).toBe(3000)

    // Et le chiffre repris ne bouge pas quand le réglage global change : le
    // gel se casse en lecture, pas en écriture.
    await updateSettings({ minutesParJour: 420 })
    const mission = (await listMissionsForUser(userId)).find((x) => x.id === d.mission.id)
    expect(mission!.lines[0]!.soldCentiemes).toBe(3000)
  })

  it('ne touche pas les saisies déjà enregistrées sur la prestation reprise', async () => {
    const d = await decor({ nom: 'PROPALE saisie', label: 'Dev' })

    const saisie = await saveEntry({
      userId,
      lineId: d.ligne.id,
      date: '2026-03-02',
      minutes: 480,
      kind: 'REALISE',
    })
    expect(saisie.ok).toBe(true)

    const avant = await prisma.timeEntry.findFirstOrThrow({ where: { lineId: d.ligne.id } })
    expect(avant.minutesParJour).toBe(480)

    await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    })

    const apres = await prisma.timeEntry.findMany({ where: { lineId: d.ligne.id } })
    expect(apres).toHaveLength(1)
    expect(apres[0]!.minutes).toBe(480)
    // Le facteur figé à l'écriture reste celui de l'écriture, quoi qu'il
    // arrive ensuite à la prestation.
    expect(apres[0]!.minutesParJour).toBe(480)

    // La reprise ne porte que sur les deux chiffres vendus : le libellé local
    // et l'unité d'affichage ne sont pas écrasés par ceux de la propale.
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.label).toBe('Dev')
    expect(relue.displayUnit).toBe('JOUR')

    // Et le cumul relu après un changement de réglage reste ventilé au facteur
    // figé, jamais reconverti au réglage courant.
    await updateSettings({ minutesParJour: 420 })
    const totaux = await getLineEngagementTotals(userId, [d.ligne.id])
    expect(totaux[d.ligne.id]).toEqual([{ kind: 'REALISE', minutes: 480, minutesParJour: 480 }])
  })

  it('remplace la correspondance quand la prestation est reprise sur une autre ligne', async () => {
    const d = await decor({
      nom: 'PROPALE reprise 2',
      lignes: [
        { label: 'Jour', qty: 30, subpriceCents: 80_000 },
        { label: 'Nuit', qty: 10, subpriceCents: 120_000 },
      ],
    })

    await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    })
    await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[1]!.id,
      api: d.api,
    })

    const liens = await prisma.externalLink.findMany({
      where: { entityType: 'MissionLinePropalLine', entityId: d.ligne.id },
    })
    expect(liens).toHaveLength(1)
    expect(liens[0]!.externalId).toBe(`${d.propale.id}:${d.propale.lines[1]!.id}`)
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.soldCentiemes).toBe(1000)
  })

  // Le cloisonnement, et il ne se vérifie pas par un motif de message : la
  // source de `propal.ts` porte le mot « affectée » dans un commentaire, que
  // Prisma recopie dans l'extrait de source accompagnant ses erreurs. Un
  // `/affect/i` était donc satisfait par l'échec en P2025 d'un `update` que la
  // garde aurait dû empêcher d'atteindre — le test passait sans elle.
  //
  // Ce qui distingue vraiment les deux : la garde refuse **avant** l'appel
  // distant, avec le refus du connecteur, et laisse l'affectation intacte.
  it('refuse de reprendre une propale sur une prestation qui ne vous est pas affectée', async () => {
    const autre = await prisma.user.create({
      data: { email: 'propale-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    const d = await decor({ nom: 'PROPALE intrus' })

    const erreur = await attachPropalLine({
      userId: autre.id,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    }).catch((e: unknown) => e)

    expect(erreur).toBeInstanceOf(DolibarrRequestError)
    expect((erreur as Error).message).toBe('Cette prestation ne vous est pas affectée.')
    // Rien n'a été lu chez Dolibarr : le refus tranche sur la base locale.
    expect(d.api.appels.getProposal).toBe(0)

    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.soldCentiemes).toBe(0)
    expect(relue.engagementSource).toBe('MANUEL')
    // L'affectation de celui à qui la prestation appartient n'a pas bougé.
    const affectation = await prisma.assignment.findUniqueOrThrow({
      where: { lineId_userId: { lineId: d.ligne.id, userId } },
    })
    expect(affectation.soldCentiemes).toBe(0)
    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('n écrit rien quand la ligne de propale n existe pas', async () => {
    const d = await decor({ nom: 'PROPALE ligne absente' })

    await expect(
      attachPropalLine({
        userId,
        lineId: d.ligne.id,
        proposalId: d.propale.id,
        propalLineId: 999_999,
        api: d.api,
      }),
    ).rejects.toThrow(/introuvable/)

    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.engagementSource).toBe('MANUEL')
  })

  it('refuse la modification locale des jours vendus et du TJM', async () => {
    const d = await decor({ nom: 'PROPALE verrou' })
    await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    })

    const jours = await updateLine({ userId, lineId: d.ligne.id, soldCentiemes: 4000 })
    expect(jours).toEqual({
      ok: false,
      reason: 'ENGAGEMENT_EXTERNE',
      message: expect.stringContaining('propale'),
    })

    const tjm = await updateLine({ userId, lineId: d.ligne.id, tjmCents: 90_000 })
    expect(tjm.ok).toBe(false)

    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.soldCentiemes).toBe(3000)
    expect(relue.tjmCents).toBe(80_000)
    const affectation = await prisma.assignment.findUniqueOrThrow({
      where: { lineId_userId: { lineId: d.ligne.id, userId } },
    })
    expect(affectation.soldCentiemes).toBe(3000)
  })

  it('refuse aussi un libellé passé en même temps qu un chiffre verrouillé', async () => {
    // Un refus partiel — le libellé passe, les jours non — laisserait croire
    // que tout est enregistré.
    const d = await decor({ nom: 'PROPALE refus entier' })
    await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    })

    const r = await updateLine({
      userId,
      lineId: d.ligne.id,
      label: 'Autre libellé',
      soldCentiemes: 4000,
    })
    expect(r.ok).toBe(false)

    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.label).toBe('Dev')
  })

  it('laisse modifier le libellé et l unité d une ligne issue d une propale', async () => {
    // Le verrou porte sur les deux chiffres qui ont une source de vérité
    // ailleurs, pas sur toute la ligne.
    const d = await decor({
      nom: 'PROPALE libelle',
      lignes: [{ label: 'Dev', qty: 10, subpriceCents: 70_000 }],
    })
    await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    })

    expect(
      await updateLine({
        userId,
        lineId: d.ligne.id,
        label: 'Développement V2',
        displayUnit: 'HEURE',
      }),
    ).toEqual({ ok: true })
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.label).toBe('Développement V2')
    expect(relue.displayUnit).toBe('HEURE')
    // Et les chiffres verrouillés n'ont pas bougé au passage.
    expect([relue.soldCentiemes, relue.tjmCents]).toEqual([1000, 70_000])
  })

  it('laisse repasser à l identique les chiffres d une ligne issue d une propale', async () => {
    // Le formulaire renvoie la valeur affichée : la renvoyer telle quelle
    // n'est pas une tentative de modification.
    const d = await decor({ nom: 'PROPALE identique' })
    await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    })

    expect(
      await updateLine({
        userId,
        lineId: d.ligne.id,
        label: 'Dev renommé',
        soldCentiemes: 3000,
        tjmCents: 80_000,
      }),
    ).toEqual({ ok: true })
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.label).toBe('Dev renommé')
  })

  it('laisse tout modifier sur une ligne manuelle', async () => {
    const c = await createClient('MANUEL client')
    const m = await createMission({ clientId: c.id, label: 'M' })
    const ligne = await createLine({
      missionId: m.id,
      userId,
      label: 'Dev',
      soldCentiemes: 1000,
      tjmCents: 50_000,
    })

    expect(
      await updateLine({ userId, lineId: ligne.id, soldCentiemes: 2000, tjmCents: 60_000 }),
    ).toEqual({ ok: true })
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(relue.soldCentiemes).toBe(2000)
    expect(relue.tjmCents).toBe(60_000)
  })

  it('met à jour la part affectée en même temps que les jours vendus', async () => {
    const c = await createClient('AFFECTATION client')
    const m = await createMission({ clientId: c.id, label: 'M' })
    const ligne = await createLine({
      missionId: m.id,
      userId,
      label: 'Dev',
      soldCentiemes: 1000,
      tjmCents: 0,
    })

    await updateLine({ userId, lineId: ligne.id, soldCentiemes: 2500 })
    const affectation = await prisma.assignment.findUniqueOrThrow({
      where: { lineId_userId: { lineId: ligne.id, userId } },
    })
    expect(affectation.soldCentiemes).toBe(2500)
  })

  it('n emprunte rien à la prestation voisine du même utilisateur', async () => {
    // Deux prestations existent bel et bien : une mise à jour qui oublierait
    // son `where` écrirait sur les deux.
    const c = await createClient('AFFECTATION voisine')
    const m = await createMission({ clientId: c.id, label: 'M' })
    const cible = await createLine({
      missionId: m.id,
      userId,
      label: 'Cible',
      soldCentiemes: 1000,
      tjmCents: 50_000,
    })
    const voisine = await createLine({
      missionId: m.id,
      userId,
      label: 'Voisine',
      soldCentiemes: 700,
      tjmCents: 40_000,
    })

    await updateLine({ userId, lineId: cible.id, label: 'Cible modifiée', soldCentiemes: 2000 })

    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: voisine.id } })
    expect(relue.label).toBe('Voisine')
    expect(relue.soldCentiemes).toBe(700)
    const affectation = await prisma.assignment.findUniqueOrThrow({
      where: { lineId_userId: { lineId: voisine.id, userId } },
    })
    expect(affectation.soldCentiemes).toBe(700)
  })

  it('refuse de modifier la ligne d une mission non affectée', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-line@test.local', name: 'A', passwordHash: 'x' },
    })
    const c = await createClient('NON AFFECTE client')
    const m = await createMission({ clientId: c.id, label: 'M' })
    const ligne = await createLine({
      missionId: m.id,
      userId,
      label: 'Dev',
      soldCentiemes: 1000,
      tjmCents: 0,
    })

    expect(await updateLine({ userId: autre.id, lineId: ligne.id, label: 'X' })).toEqual({
      ok: false,
      reason: 'NON_AFFECTE',
    })

    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(relue.label).toBe('Dev')

    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('expose la source d engagement de chaque ligne', async () => {
    const c = await createClient('SOURCE client')
    const m = await createMission({ clientId: c.id, label: 'SOURCE mission' })
    await createLine({ missionId: m.id, userId, label: 'Dev', soldCentiemes: 100, tjmCents: 0 })

    const mission = (await listMissionsForUser(userId)).find((x) => x.label === 'SOURCE mission')
    expect(mission!.lines[0]!.engagementSource).toBe('MANUEL')
  })

  it('expose DOLIBARR_PROPALE dès qu une ligne est reprise', async () => {
    const d = await decor({ nom: 'PROPALE source' })
    await attachPropalLine({
      userId,
      lineId: d.ligne.id,
      proposalId: d.propale.id,
      propalLineId: d.propale.lines[0]!.id,
      api: d.api,
    })

    const mission = (await listMissionsForUser(userId)).find((x) => x.id === d.mission.id)
    expect(mission!.lines[0]!.engagementSource).toBe('DOLIBARR_PROPALE')
  })

  it('ne bloque jamais la saisie manuelle quand Dolibarr est en panne', async () => {
    // « C'est un complément, pas une obligation. »
    const d = await decor({ nom: 'PROPALE panne' })
    d.api.panne = true

    await expect(
      attachPropalLine({
        userId,
        lineId: d.ligne.id,
        proposalId: d.propale.id,
        propalLineId: d.propale.lines[0]!.id,
        api: d.api,
      }),
    ).rejects.toThrow()

    expect(await updateLine({ userId, lineId: d.ligne.id, soldCentiemes: 1500 })).toEqual({
      ok: true,
    })
    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: d.ligne.id } })
    expect(relue.soldCentiemes).toBe(1500)
  })
})

describe('renommer une mission', () => {
  /** Une mission affectée à `userId`, avec sa correspondance de projet Dolibarr. */
  async function decorRenommage(nom: string) {
    const c = await createClient(`RENOMMAGE ${nom}`)
    const m = await createMission({ clientId: c.id, label: 'Ancien libellé' })
    await createLine({ missionId: m.id, userId, label: 'L', soldCentiemes: 100, tjmCents: 0 })
    return m
  }

  /**
   * **Le libellé n'est pas décoratif** : il part dans le PDF envoyé au client
   * et nomme le projet chez Dolibarr. Un nom qui change sans laisser de trace
   * rend inexplicable, six mois plus tard, l'écart entre un CRA archivé et la
   * mission qui le porte.
   */
  /** Le dernier `seq` du journal. `readAuditSince(0)` plafonne, et le plafond
   *  ment dès que le fichier a produit plus d'entrées que la page. */
  async function derniereSeq(): Promise<number> {
    const tete = await prisma.auditEvent.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } })
    return tete?.seq ?? 0
  }

  it('CONSIGNE LE RENOMMAGE, avec l avant et l apres', async () => {
    const m = await decorRenommage('journal')
    const avant = await derniereSeq()

    await updateMissionLabel(userId, m.id, 'AMOA ITSM')

    const trace = (await readAuditSince({ since: avant, action: 'mission.renommee' })).at(0)
    expect(trace).toBeDefined()
    expect(trace!.entityId).toBe(m.id)
    // Sans l'avant, on sait qu'un nom a changé sans savoir lequel.
    expect(trace!.payload).toMatchObject({ avant: 'Ancien libellé', apres: 'AMOA ITSM' })
  })

  // Le formulaire repose le champ à chaque soumission : consigner une
  // « modification » identique noierait le journal sous des non-événements.
  it('ne consigne rien quand le libellé ne change pas', async () => {
    const m = await decorRenommage('idempotent')
    const avant = await derniereSeq()

    await updateMissionLabel(userId, m.id, 'Ancien libellé')

    expect(await readAuditSince({ since: avant, action: 'mission.renommee' })).toEqual([])
  })

  it('renomme, et le détail de la mission le montre', async () => {
    const m = await decorRenommage('simple')

    expect(await updateMissionLabel(userId, m.id, 'AMOA ITSM')).toEqual({ ok: true })

    const relue = await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })
    expect(relue.label).toBe('AMOA ITSM')
    expect((await listMissionsForUser(userId)).find((x) => x.id === m.id)!.label).toBe('AMOA ITSM')
  })

  it('coupe les espaces qui entourent le libellé', async () => {
    const m = await decorRenommage('espaces')

    await updateMissionLabel(userId, m.id, '   AMOA ITSM   ')

    expect((await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })).label).toBe('AMOA ITSM')
  })

  // Une mission sans libellé n'est plus reconnaissable dans la liste, et la
  // confirmation de suppression — recopier le libellé — n'aurait plus rien à
  // recopier.
  it('refuse un libellé vide, et n écrit rien', async () => {
    const m = await decorRenommage('vide')

    const r = await updateMissionLabel(userId, m.id, '   ')

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toContain('libellé')
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })).label).toBe(
      'Ancien libellé',
    )
  })

  // Même règle que le signataire : sans ligne affectée, la mission n'est pas
  // la sienne.
  it('refuse une mission qui ne lui est pas affectée, et n écrit rien', async () => {
    const m = await decorRenommage('non affectee')
    const autre = await prisma.user.create({
      data: {
        email: 'autre-renommage@test.local',
        name: 'A',
        passwordHash: 'x',
        role: 'CONSULTANT',
      },
    })

    const r = await updateMissionLabel(autre.id, m.id, 'Volée')

    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erreur).toContain('affectée')
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: m.id } })).label).toBe(
      'Ancien libellé',
    )

    await prisma.user.delete({ where: { id: autre.id } })
  })

  /**
   * **La règle du produit.** Renommer est local. Le projet Dolibarr porte la
   * référence d'un bon de commande et le titre que le client connaît : le
   * renommer depuis ici modifierait un document commercial, ce que
   * l'application ne fait jamais.
   */
  it('ne pousse rien chez Dolibarr, et laisse la correspondance intacte', async () => {
    const m = await decorRenommage('dolibarr')
    const lien = await prisma.externalLink.create({
      data: {
        userId,
        entityType: 'Mission',
        entityId: m.id,
        provider: DOLIBARR,
        externalId: '178',
        syncState: 'SYNCED',
        etag: 'abc',
      },
    })
    const enFileAvant = await prisma.syncOutbox.count()

    await updateMissionLabel(userId, m.id, 'Nouveau nom local')

    expect(await prisma.syncOutbox.count()).toBe(enFileAvant)
    const relu = await prisma.externalLink.findUniqueOrThrow({ where: { id: lien.id } })
    expect([relu.externalId, relu.syncState, relu.etag]).toEqual(['178', 'SYNCED', 'abc'])

    await prisma.externalLink.delete({ where: { id: lien.id } })
  })
})
