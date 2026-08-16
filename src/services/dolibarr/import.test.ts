import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { FakeDolibarr } from './fake'
import { DOLIBARR } from './api'
import {
  listImportCandidates,
  attachClient,
  createClientFromDolibarr,
  attachMission,
  createMissionFromDolibarr,
  pushClientToDolibarr,
  detachEntity,
} from './import'

let userId = ''
let autreUserId = ''
let api: FakeDolibarr

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'import@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'import-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreUserId = a.id
})

async function nettoyer(): Promise<void> {
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'IMPORT' } } })
}

beforeEach(async () => {
  await nettoyer()
  api = new FakeDolibarr()
})

afterAll(async () => {
  await nettoyer()
  await prisma.user.deleteMany({
    where: { email: { in: ['import@test.local', 'import-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

describe('import initial', () => {
  it('liste les tiers et les projets facturables au temps', async () => {
    api.seedThirdparty('IMPORT ACME')
    api.seedProject({ ref: 'PJ001', title: 'IMPORT Facturable', socid: 1 })
    api.seedProject({ ref: 'PJ002', title: 'IMPORT Interne', socid: 1, usageBillTime: false })

    const c = await listImportCandidates(userId, api)
    expect(c.tiers.map((t) => t.name)).toEqual(['IMPORT ACME'])
    expect(c.projets.map((p) => p.ref)).toEqual(['PJ001'])
    expect(c.tiers[0]!.clientId).toBeNull()
  })

  it('signale les objets déjà rattachés', async () => {
    const tiers = api.seedThirdparty('IMPORT ACME')
    const local = await createClient('IMPORT ACME local')
    await attachClient({ userId, clientId: local.id, dolibarrThirdpartyId: tiers.id })

    const c = await listImportCandidates(userId, api)
    expect(c.tiers[0]!.clientId).toBe(local.id)
    expect(c.tiers[0]!.clientName).toBe('IMPORT ACME local')
  })

  it('signale une mission rattachée avec son libellé', async () => {
    const tiers = api.seedThirdparty('IMPORT ACME')
    const projet = api.seedProject({ ref: 'PJ001', title: 'IMPORT ITSM', socid: tiers.id })
    const client = await createClient('IMPORT client')
    await attachClient({ userId, clientId: client.id, dolibarrThirdpartyId: tiers.id })
    const mission = await createMission({ clientId: client.id, label: 'IMPORT mission à moi' })
    await createLine({
      missionId: mission.id,
      userId,
      label: 'Consultant',
      soldCentiemes: 1000,
      tjmCents: 60000,
    })
    await attachMission({
      userId,
      missionId: mission.id,
      dolibarrProjectId: projet.id,
      projectRef: projet.ref,
      projectSocid: projet.socid,
    })

    const c = await listImportCandidates(userId, api)
    expect(c.projets[0]!.missionId).toBe(mission.id)
    expect(c.projets[0]!.missionLabel).toBe('IMPORT mission à moi')
  })

  it('ne divulgue pas le libellé d une mission portée par un autre consultant', async () => {
    // La correspondance est un fait de l'instance : elle reste signalée, sinon
    // l'écran proposerait de rattacher un projet déjà pris et créerait un
    // doublon. Le **libellé**, lui, suit le cloisonnement des missions — comme
    // partout ailleurs dans l'application.
    const tiers = api.seedThirdparty('IMPORT ACME')
    const projet = api.seedProject({ ref: 'PJ001', title: 'IMPORT ITSM', socid: tiers.id })
    const client = await createClient('IMPORT client')
    await attachClient({ userId: autreUserId, clientId: client.id, dolibarrThirdpartyId: tiers.id })
    const mission = await createMission({ clientId: client.id, label: 'IMPORT mission des autres' })
    await createLine({
      missionId: mission.id,
      userId: autreUserId,
      label: 'Consultant',
      soldCentiemes: 1000,
      tjmCents: 60000,
    })
    await attachMission({
      userId: autreUserId,
      missionId: mission.id,
      dolibarrProjectId: projet.id,
      projectRef: projet.ref,
      projectSocid: projet.socid,
    })

    const c = await listImportCandidates(userId, api)
    expect(c.projets[0]!.missionId).toBe(mission.id)
    expect(c.projets[0]!.missionLabel).toBeNull()
  })

  it('ne divulgue pas le nom d un client porté par un autre consultant', async () => {
    const tiers = api.seedThirdparty('IMPORT ACME')
    const client = await createClient('IMPORT client des autres')
    const mission = await createMission({ clientId: client.id, label: 'IMPORT mission' })
    await createLine({
      missionId: mission.id,
      userId: autreUserId,
      label: 'Consultant',
      soldCentiemes: 1000,
      tjmCents: 60000,
    })
    await attachClient({ userId: autreUserId, clientId: client.id, dolibarrThirdpartyId: tiers.id })

    const c = await listImportCandidates(userId, api)
    expect(c.tiers[0]!.clientId).toBe(client.id)
    expect(c.tiers[0]!.clientName).toBeNull()
  })

  it('ne prend pas la correspondance d un autre fournisseur pour la sienne', async () => {
    // La file de sortie est générique depuis la tâche 6 : `Client` peut porter
    // un lien vers un tout autre fournisseur. Lu sans filtre, un identifiant
    // externe qui se trouve valoir « 1 » ferait passer un tiers Dolibarr pour
    // déjà rattaché, et l'écran refuserait de le rattacher pour de bon.
    const tiers = api.seedThirdparty('IMPORT ACME')
    const local = await createClient('IMPORT ACME local')
    await prisma.externalLink.create({
      data: {
        userId,
        entityType: 'Client',
        entityId: local.id,
        provider: 'AUTRE_FOURNISSEUR',
        externalId: String(tiers.id),
      },
    })

    const c = await listImportCandidates(userId, api)
    expect(c.tiers[0]!.clientId).toBeNull()

    await prisma.externalLink.deleteMany({ where: { provider: 'AUTRE_FOURNISSEUR' } })
  })

  it('rattache sans jamais créer de doublon', async () => {
    const tiers = api.seedThirdparty('IMPORT ACME')
    const local = await createClient('IMPORT ACME local')

    await attachClient({ userId, clientId: local.id, dolibarrThirdpartyId: tiers.id })
    await attachClient({ userId, clientId: local.id, dolibarrThirdpartyId: tiers.id })

    expect(await prisma.externalLink.count({ where: { entityType: 'Client' } })).toBe(1)
  })

  it('inscrit l auteur du rattachement sur la correspondance', async () => {
    // `ExternalLink.userId` n'est pas décoratif : la colonne est obligatoire
    // depuis la revue du lot 1b, et c'est elle qu'indexe toute reprise par
    // compte. Une correspondance posée sans elle ne s'écrit pas du tout.
    const tiers = api.seedThirdparty('IMPORT ACME')
    const local = await createClient('IMPORT ACME local')
    await attachClient({ userId, clientId: local.id, dolibarrThirdpartyId: tiers.id })

    const lien = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: 'Client', entityId: local.id, provider: DOLIBARR },
    })
    expect(lien.userId).toBe(userId)
  })

  it('crée un client local à partir d un tiers', async () => {
    const tiers = api.seedThirdparty('IMPORT ACME')
    const { clientId } = await createClientFromDolibarr({
      userId,
      dolibarrThirdpartyId: tiers.id,
      name: 'IMPORT ACME',
    })

    expect((await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).name).toBe(
      'IMPORT ACME',
    )
    const lien = await prisma.externalLink.findUniqueOrThrow({
      where: {
        entityType_entityId_provider: {
          entityType: 'Client',
          entityId: clientId,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien.externalId).toBe(String(tiers.id))
  })

  it('crée une mission locale à partir d un projet', async () => {
    const c = await createClient('IMPORT client')
    const tiers = api.seedThirdparty('IMPORT ACME')
    await attachClient({ userId, clientId: c.id, dolibarrThirdpartyId: tiers.id })
    const projet = api.seedProject({ ref: 'PJ001', title: 'IMPORT ITSM', socid: tiers.id })

    const { missionId } = await createMissionFromDolibarr({
      userId,
      clientId: c.id,
      dolibarrProjectId: projet.id,
      projectRef: projet.ref,
      projectSocid: projet.socid,
      label: 'IMPORT ITSM',
    })

    expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).label).toBe(
      'IMPORT ITSM',
    )
    const lien = await prisma.externalLink.findUniqueOrThrow({
      where: {
        entityType_entityId_provider: {
          entityType: 'Mission',
          entityId: missionId,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien.externalId).toBe(String(projet.id))
  })

  it('pousse un client local vers Dolibarr et mémorise la correspondance', async () => {
    const local = await createClient('IMPORT poussé')
    const { dolibarrThirdpartyId } = await pushClientToDolibarr({
      userId,
      clientId: local.id,
      api,
    })

    expect(api.thirdparties.map((t) => t.name)).toEqual(['IMPORT poussé'])
    const lien = await prisma.externalLink.findUniqueOrThrow({
      where: {
        entityType_entityId_provider: {
          entityType: 'Client',
          entityId: local.id,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien.externalId).toBe(String(dolibarrThirdpartyId))
  })

  it('ne pousse pas deux fois le même client', async () => {
    const local = await createClient('IMPORT poussé')
    const a = await pushClientToDolibarr({ userId, clientId: local.id, api })
    const b = await pushClientToDolibarr({ userId, clientId: local.id, api })

    expect(b.dolibarrThirdpartyId).toBe(a.dolibarrThirdpartyId)
    expect(api.thirdparties).toHaveLength(1)
  })

  it('laisse la base locale intacte quand Dolibarr est en panne', async () => {
    const local = await createClient('IMPORT poussé')
    api.panne = true

    await expect(pushClientToDolibarr({ userId, clientId: local.id, api })).rejects.toThrow()
    expect(await prisma.externalLink.count({ where: { entityType: 'Client' } })).toBe(0)
  })

  it('détache sans supprimer l objet local', async () => {
    const tiers = api.seedThirdparty('IMPORT ACME')
    const local = await createClient('IMPORT ACME local')
    await attachClient({ userId, clientId: local.id, dolibarrThirdpartyId: tiers.id })

    await detachEntity({ userId, entityType: 'Client', entityId: local.id })

    expect(await prisma.externalLink.count({ where: { entityType: 'Client' } })).toBe(0)
    expect(await prisma.client.findUnique({ where: { id: local.id } })).not.toBeNull()
  })

  it('ne détache que l objet visé', async () => {
    // Un `deleteMany` mal filtré effacerait la table entière sans qu'aucune
    // assertion de « 0 lien restant » ne s'en aperçoive.
    const t1 = api.seedThirdparty('IMPORT ACME')
    const t2 = api.seedThirdparty('IMPORT AUTRE')
    const projet = api.seedProject({ ref: 'PJ001', title: 'IMPORT ITSM', socid: 1 })

    const c1 = await createClient('IMPORT ACME local')
    const c2 = await createClient('IMPORT AUTRE local')
    const mission = await createMission({ clientId: c1.id, label: 'IMPORT mission' })

    await attachClient({ userId, clientId: c1.id, dolibarrThirdpartyId: t1.id })
    await attachClient({ userId, clientId: c2.id, dolibarrThirdpartyId: t2.id })
    await attachMission({
      userId,
      missionId: mission.id,
      dolibarrProjectId: projet.id,
      projectRef: projet.ref,
      projectSocid: projet.socid,
    })

    await detachEntity({ userId, entityType: 'Client', entityId: c1.id })

    const restants = await prisma.externalLink.findMany({
      where: { provider: DOLIBARR },
      select: { entityType: true, entityId: true },
    })
    expect(restants).toHaveLength(2)
    expect(restants).toContainEqual({ entityType: 'Client', entityId: c2.id })
    expect(restants).toContainEqual({ entityType: 'Mission', entityId: mission.id })
  })

  it('refuse de rattacher le projet du tiers A à une mission du client B', async () => {
    // Le danger fermé par cette tâche : sans ce refus, les temps partiraient
    // quand même, et la demande de facture avec eux, chez le mauvais client.
    const tiersA = api.seedThirdparty('IMPORT A')
    const tiersB = api.seedThirdparty('IMPORT B')
    const projetDeA = api.seedProject({ ref: 'PJ-A', title: 'IMPORT projet A', socid: tiersA.id })
    const clientB = await createClient('IMPORT client B')
    await attachClient({ userId, clientId: clientB.id, dolibarrThirdpartyId: tiersB.id })
    const missionDeB = await createMission({ clientId: clientB.id, label: 'IMPORT mission B' })

    await expect(
      attachMission({
        userId,
        missionId: missionDeB.id,
        dolibarrProjectId: projetDeA.id,
        projectRef: projetDeA.ref,
        projectSocid: projetDeA.socid,
      }),
    ).rejects.toThrow(/PJ-A.*IMPORT client B/s)

    expect(
      await prisma.externalLink.count({ where: { entityType: 'Mission', entityId: missionDeB.id } }),
    ).toBe(0)
  })

  it('refuse de créer une mission sous un client dont le tiers ne correspond pas au projet, sans laisser de mission orpheline', async () => {
    const tiersA = api.seedThirdparty('IMPORT A')
    const tiersB = api.seedThirdparty('IMPORT B')
    const projetDeA = api.seedProject({ ref: 'PJ-A', title: 'IMPORT projet A', socid: tiersA.id })
    const clientB = await createClient('IMPORT client B')
    await attachClient({ userId, clientId: clientB.id, dolibarrThirdpartyId: tiersB.id })

    await expect(
      createMissionFromDolibarr({
        userId,
        clientId: clientB.id,
        dolibarrProjectId: projetDeA.id,
        projectRef: projetDeA.ref,
        projectSocid: projetDeA.socid,
        label: 'IMPORT mission orpheline',
      }),
    ).rejects.toThrow(/PJ-A.*IMPORT client B/s)

    expect(await prisma.mission.count({ where: { clientId: clientB.id } })).toBe(0)
  })

  it('refuse de rattacher un projet à tiers tant que le client de la mission n est pas rattaché', async () => {
    // L'ordre des opérations : rattacher la mission avant le client ne
    // fournit aucun tiers attendu à comparer. Rien ne l'autorise en silence.
    const tiers = api.seedThirdparty('IMPORT ACME')
    const projet = api.seedProject({ ref: 'PJ001', title: 'IMPORT ITSM', socid: tiers.id })
    const client = await createClient('IMPORT client non rattaché')
    const mission = await createMission({ clientId: client.id, label: 'IMPORT mission' })

    await expect(
      attachMission({
        userId,
        missionId: mission.id,
        dolibarrProjectId: projet.id,
        projectRef: projet.ref,
        projectSocid: projet.socid,
      }),
    ).rejects.toThrow(/PJ001.*aucun tiers Dolibarr/s)

    expect(
      await prisma.externalLink.count({ where: { entityType: 'Mission', entityId: mission.id } }),
    ).toBe(0)
  })

  it('accepte un projet sans tiers Dolibarr, sans rien exiger de la cohérence', async () => {
    // Dolibarr autorise un projet sans tiers (par exemple interne) : rien à
    // contredire, donc rien à refuser, même si le client de la mission n est
    // pas rattaché.
    const projet = api.seedProject({ ref: 'PJ-INTERNE', title: 'IMPORT interne', socid: null })
    const client = await createClient('IMPORT client')
    const mission = await createMission({ clientId: client.id, label: 'IMPORT mission' })

    await attachMission({
      userId,
      missionId: mission.id,
      dolibarrProjectId: projet.id,
      projectRef: projet.ref,
      projectSocid: projet.socid,
    })

    expect(
      await prisma.externalLink.count({ where: { entityType: 'Mission', entityId: mission.id } }),
    ).toBe(1)
  })

  it('propage la panne au lieu de rendre une liste silencieusement vide', async () => {
    // Une liste vide se confondrait avec « Dolibarr n'a rien à proposer ».
    // C'est la page qui attrape et affiche l'indisponibilité, en gardant le
    // formulaire de connexion accessible.
    api.panne = true
    await expect(listImportCandidates(userId, api)).rejects.toThrow()
  })
})
