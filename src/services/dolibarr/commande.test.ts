import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine, updateLine } from '@/services/missions'
import { FakeDolibarr } from './fake'
import { DOLIBARR } from './api'
import { LIEN_COMMANDE, LIEN_LIGNE, LIEN_MISSION } from './liens'
import { attachClient } from './import'
import {
  attachOrderLine,
  creerMissionAvecProjet,
  creerProjetDepuisCommande,
  listerCommandes,
  listerCommandesRattachables,
} from './commande'

let userId = ''
let autreUserId = ''
let api: FakeDolibarr

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'commande@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'commande-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreUserId = a.id
})

async function nettoyer(): Promise<void> {
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.client.deleteMany({ where: { name: { startsWith: 'CMD' } } })
}

beforeEach(async () => {
  await nettoyer()
  api = new FakeDolibarr()
})

afterAll(async () => {
  await nettoyer()
  await prisma.user.deleteMany({
    where: { email: { in: ['commande@test.local', 'commande-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

/** Un client local rattaché à un tiers Dolibarr, et une mission dessous. */
async function contexte(): Promise<{ tiersId: number; clientId: string; missionId: string }> {
  const tiers = api.seedThirdparty('CMD ACME')
  const client = await createClient('CMD ACME local')
  await attachClient({ userId, clientId: client.id, dolibarrThirdpartyId: tiers.id })
  const mission = await createMission({ clientId: client.id, label: 'CMD Mission' })
  return { tiersId: tiers.id, clientId: client.id, missionId: mission.id }
}

describe('listerCommandes', () => {
  it('ne garde que ce qui reste à faire : ni brouillon, ni annulée, ni livrée, ni facturée', async () => {
    const t = api.seedThirdparty('CMD ACME')
    api.seedOrder({ ref: 'CO-VALIDEE', socid: t.id, statut: 1 })
    api.seedOrder({ ref: 'CO-EN-COURS', socid: t.id, statut: 2 })
    // Close : le travail y est fini, ouvrir un projet pour y saisir des temps
    // à venir n'a plus de sens.
    api.seedOrder({ ref: 'CO-LIVREE', socid: t.id, statut: 3 })
    api.seedOrder({ ref: 'CO-BROUILLON', socid: t.id, statut: 0 })
    api.seedOrder({ ref: 'CO-ANNULEE', socid: t.id, statut: -1 })
    // Entièrement facturée : plus rien à consommer, le projet ne serait
    // jamais facturé.
    api.seedOrder({ ref: 'CO-FACTUREE', socid: t.id, statut: 1, facturee: true })

    const commandes = await listerCommandes(api)
    expect(commandes.map((c) => c.ref).sort()).toEqual(['CO-EN-COURS', 'CO-VALIDEE'])
  })
})

describe('listerCommandesRattachables', () => {
  it('propose aussi les commandes qui portent déjà un projet', async () => {
    // Les deux seules commandes en cours de l'instance du porteur pointent
    // chacune vers un projet créé à la main : les écarter les rendait
    // introuvables, alors que c'est le cas normal — le projet existe, la
    // mission manque.
    const { tiersId } = await contexte()
    const projet = api.seedProject({ ref: 'PJ-EXISTANT', title: 'I26-EPM', socid: tiersId })
    api.seedOrder({ ref: 'CO-SANS-PROJET', socid: tiersId })
    api.seedOrder({ ref: 'CO-AVEC-PROJET', socid: tiersId, projectId: projet.id })

    const liste = await listerCommandesRattachables({ userId, api })
    expect(liste.map((c) => c.ref).sort()).toEqual(['CO-AVEC-PROJET', 'CO-SANS-PROJET'])
  })

  it('nomme la mission qui suit déjà le projet d’une commande', async () => {
    const { tiersId, missionId } = await contexte()
    const projet = api.seedProject({ ref: 'PJ-PRIS', title: 'Guichet', socid: tiersId })
    const commande = api.seedOrder({ ref: 'CO-PRISE', socid: tiersId, projectId: projet.id })
    await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'MISSION', missionId },
      api,
    })

    const liste = await listerCommandesRattachables({ userId, api })
    const prise = liste.find((c) => c.ref === 'CO-PRISE')
    expect(prise?.missionId).toBe(missionId)
    expect(prise?.missionLabel).toBe('CMD Mission')
  })
})

describe('creerProjetDepuisCommande', () => {
  it('crée le projet, reporte la référence client et rattache la commande', async () => {
    const { tiersId, missionId } = await contexte()
    const commande = api.seedOrder({
      ref: 'CO2608-0042',
      socid: tiersId,
      refClient: 'BDC-2026-118',
      label: 'AMOA ITSM',
    })

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'MISSION', missionId },
      api,
    })

    expect(r.projetExistant).toBe(false)
    expect(r.sansReferenceClient).toBe(false)
    expect(r.commandeNonRattachee).toBeNull()
    expect(r.projet.title).toBe('BDC-2026-118 — CMD ACME — AMOA ITSM — CO2608-0042')
    // Le report machine : c'est lui qui survit à un renommage du projet.
    expect(api.refExtDuProjet(r.projet.id)).toBe('BDC-2026-118')
    // Et le retour côté commande, sans lequel la facture ne retrouve pas le BDC.
    expect((await api.getOrder(commande.id)).projectId).toBe(r.projet.id)

    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_MISSION,
          entityId: missionId,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien?.externalId).toBe(String(r.projet.id))
  })

  it('signale une commande sans référence client au lieu d’en inventer une', async () => {
    const { tiersId, missionId } = await contexte()
    const commande = api.seedOrder({ ref: 'CO2608-0043', socid: tiersId, label: 'Run' })

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'MISSION', missionId },
      api,
    })

    expect(r.sansReferenceClient).toBe(true)
    expect(api.refExtDuProjet(r.projet.id)).toBe('')
    expect(r.projet.title).toBe('CO2608-0043 — CMD ACME — Run')
  })

  it('ne crée pas un second projet quand la commande en porte déjà un', async () => {
    const { tiersId, missionId } = await contexte()
    const projet = api.seedProject({ ref: 'PJ-DEJA', title: 'Déjà là', socid: tiersId })
    const commande = api.seedOrder({
      ref: 'CO2608-0044',
      socid: tiersId,
      refClient: 'BDC-9',
      projectId: projet.id,
    })

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'MISSION', missionId },
      api,
    })

    expect(r.projetExistant).toBe(true)
    expect(r.projet.id).toBe(projet.id)
    expect(api.appels.createProject).toBe(0)
  })

  it('refuse la commande d’un autre tiers — et refuse avant de créer quoi que ce soit', async () => {
    const { missionId } = await contexte()
    const autre = api.seedThirdparty('CMD AUTRE')
    const commande = api.seedOrder({ ref: 'CO2608-0045', socid: autre.id, refClient: 'BDC-X' })

    await expect(
      creerProjetDepuisCommande({
        userId,
        orderId: commande.id,
        cible: { type: 'MISSION', missionId },
        api,
      }),
    ).rejects.toThrow(/mauvais client/i)

    expect(api.appels.createProject).toBe(0)
    expect(api.appels.linkOrderToProject).toBe(0)
  })

  it('refuse un projet déjà porté par la commande mais non facturable au temps', async () => {
    const { tiersId, missionId } = await contexte()
    const interne = api.seedProject({
      ref: 'PJ-INTERNE',
      title: 'Interne',
      socid: tiersId,
      usageBillTime: false,
    })
    const commande = api.seedOrder({ ref: 'CO2608-0046', socid: tiersId, projectId: interne.id })

    await expect(
      creerProjetDepuisCommande({
        userId,
        orderId: commande.id,
        cible: { type: 'MISSION', missionId },
        api,
      }),
    ).rejects.toThrow(/facturable au temps/i)
    expect(api.appels.createProject).toBe(0)
  })

  it('garde le projet et le dit quand le rattachement de la commande échoue', async () => {
    const { tiersId, missionId } = await contexte()
    const commande = api.seedOrder({ ref: 'CO2608-0047', socid: tiersId, refClient: 'BDC-7' })
    api.linkOrderToProject = async () => {
      throw new Error('Dolibarr a refusé la mise à jour de la commande.')
    }

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'MISSION', missionId },
      api,
    })

    expect(r.projet.id).toBeGreaterThan(0)
    expect(r.commandeNonRattachee).toMatch(/refusé/i)
    // La mission pointe quand même : sans ça, l'écran proposerait de recommencer
    // — et un second projet naîtrait pour le même bon de commande.
    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_MISSION,
          entityId: missionId,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien?.externalId).toBe(String(r.projet.id))
  })

  it('crée la mission locale quand on ne lui en désigne aucune', async () => {
    const tiers = api.seedThirdparty('CMD ACME')
    const client = await createClient('CMD ACME local')
    await attachClient({ userId, clientId: client.id, dolibarrThirdpartyId: tiers.id })
    const commande = api.seedOrder({
      ref: 'CO2608-0048',
      socid: tiers.id,
      refClient: 'BDC-11',
      label: 'Guichet unique',
    })

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'NOUVELLE_MISSION', clientId: client.id },
      api,
    })

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: r.missionId } })
    expect(mission.label).toBe('BDC-11 — CMD ACME — Guichet unique — CO2608-0048')
    expect(mission.clientId).toBe(client.id)
  })
})

describe('creerProjetDepuisCommande — depuis le tiers', () => {
  it('crée le client local quand le tiers n’en a encore aucun', async () => {
    // Exiger le rattachement préalable dans les réglages obligeait à quitter la
    // création de mission pour y revenir.
    const tiers = api.seedThirdparty('CMD NOUVEAU TIERS')
    const commande = api.seedOrder({
      ref: 'CO2608-0060',
      socid: tiers.id,
      refClient: 'BDC-60',
    })

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'DEPUIS_LE_TIERS' },
      api,
    })

    const mission = await prisma.mission.findUniqueOrThrow({
      where: { id: r.missionId },
      select: { clientId: true, client: { select: { name: true } } },
    })
    expect(mission.client.name).toBe('CMD NOUVEAU TIERS')
    expect(r.projet.title).toBe('BDC-60 — CMD NOUVEAU TIERS — CO2608-0060')

    // La correspondance est posée : une seconde création la retrouvera au lieu
    // de créer un second client pour le même tiers.
    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: 'Client',
          entityId: mission.clientId,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien?.externalId).toBe(String(tiers.id))
  })

  it('réutilise le client déjà rattaché au tiers, sans en créer un second', async () => {
    const { tiersId, clientId } = await contexte()
    const commande = api.seedOrder({ ref: 'CO2608-0061', socid: tiersId, refClient: 'BDC-61' })

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'DEPUIS_LE_TIERS' },
      api,
    })

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: r.missionId } })
    expect(mission.clientId).toBe(clientId)
    expect(await prisma.client.count({ where: { name: { startsWith: 'CMD' } } })).toBe(1)
  })
})

describe('les prestations et leurs tâches, à la naissance de la mission', () => {
  it('crée une prestation et une tâche par ligne de service', async () => {
    // Le flux du porteur va propale → commande → projet → tâches → saisie :
    // les tâches appartiennent à l'ouverture du chantier, pas au premier envoi
    // de temps.
    const tiers = api.seedThirdparty('CMD ACME')
    const client = await createClient('CMD ACME local')
    await attachClient({ userId, clientId: client.id, dolibarrThirdpartyId: tiers.id })
    const commande = api.seedOrder({
      ref: 'CO2608-0070',
      socid: tiers.id,
      refClient: 'BDC-70',
      lines: [
        { label: 'Consultant ITSM', qty: 30, subpriceCents: 80_000 },
        { label: 'Astreinte', qty: 10, subpriceCents: 120_000 },
      ],
    })

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'DEPUIS_LE_TIERS' },
      api,
    })

    expect(r.prestationsCreees).toBe(2)
    expect(r.tachesCreees).toBe(2)

    const prestations = await prisma.missionLine.findMany({
      where: { missionId: r.missionId },
      orderBy: { label: 'asc' },
    })
    expect(prestations.map((l) => l.label)).toEqual(['Astreinte', 'Consultant ITSM'])
    expect(prestations.map((l) => l.soldCentiemes)).toEqual([1000, 3000])
    expect(prestations.map((l) => l.tjmCents)).toEqual([120_000, 80_000])
    expect(prestations.every((l) => l.engagementSource === 'DOLIBARR_COMMANDE')).toBe(true)

    // Chaque prestation pointe sur sa tâche : c'est ce lien que le push
    // retrouvera au lieu d'en créer une seconde.
    for (const p of prestations) {
      const lien = await prisma.externalLink.findUnique({
        where: {
          entityType_entityId_provider: {
            entityType: LIEN_LIGNE,
            entityId: p.id,
            provider: DOLIBARR,
          },
        },
      })
      expect(lien, p.label).not.toBeNull()
      expect(api.tasks.some((t) => String(t.id) === lien!.externalId)).toBe(true)
    }
  })

  it('écarte les lignes de produit : elles ne vendent pas du temps', async () => {
    // Reprendre une ligne de cinq t-shirts donnerait « 5 jours vendus ».
    const tiers = api.seedThirdparty('CMD ACME')
    const client = await createClient('CMD ACME local')
    await attachClient({ userId, clientId: client.id, dolibarrThirdpartyId: tiers.id })
    const commande = api.seedOrder({
      ref: 'CO2608-0071',
      socid: tiers.id,
      lines: [
        { label: 'Consultant', qty: 10, subpriceCents: 80_000 },
        { label: 'T-shirt', qty: 5, subpriceCents: 800, service: false },
      ],
    })

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'DEPUIS_LE_TIERS' },
      api,
    })

    expect(r.prestationsCreees).toBe(1)
    const prestations = await prisma.missionLine.findMany({ where: { missionId: r.missionId } })
    expect(prestations.map((l) => l.label)).toEqual(['Consultant'])
  })

  it('réutilise une tâche du projet qui porte déjà ce libellé', async () => {
    // Le push cherche la tâche par son libellé : en créer une seconde ferait
    // partir les temps sur l'une et laisserait l'autre vide.
    const tiers = api.seedThirdparty('CMD ACME')
    const client = await createClient('CMD ACME local')
    await attachClient({ userId, clientId: client.id, dolibarrThirdpartyId: tiers.id })
    const projet = api.seedProject({ ref: 'PJ-EXISTANT', title: 'Déjà', socid: tiers.id })
    const dejaLa = await api.createTask({ projectId: projet.id, label: 'Consultant' })
    const avant = api.appels.createTask

    const commande = api.seedOrder({
      ref: 'CO2608-0072',
      socid: tiers.id,
      projectId: projet.id,
      lines: [{ label: 'Consultant', qty: 10, subpriceCents: 80_000 }],
    })

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'DEPUIS_LE_TIERS' },
      api,
    })

    expect(r.tachesCreees).toBe(0)
    expect(api.appels.createTask).toBe(avant)
    const prestation = await prisma.missionLine.findFirstOrThrow({
      where: { missionId: r.missionId },
    })
    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_LIGNE,
          entityId: prestation.id,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien?.externalId).toBe(String(dejaLa.id))
  })

  it('n’ouvre rien sur une mission qui existe déjà', async () => {
    const { tiersId, missionId } = await contexte()
    const commande = api.seedOrder({
      ref: 'CO2608-0073',
      socid: tiersId,
      lines: [{ label: 'Consultant', qty: 10, subpriceCents: 80_000 }],
    })

    const r = await creerProjetDepuisCommande({
      userId,
      orderId: commande.id,
      cible: { type: 'MISSION', missionId },
      api,
    })

    expect(r.prestationsCreees).toBe(0)
    expect(await prisma.missionLine.count({ where: { missionId } })).toBe(0)
  })
})

describe('creerMissionAvecProjet', () => {
  it('laisse la mission locale quand on ne demande aucun projet', async () => {
    const client = await createClient('CMD ACME local')
    const r = await creerMissionAvecProjet({
      userId,
      clientId: client.id,
      label: 'CMD Locale',
      minutesParJour: null,
      signataireNom: '',
      signataireEmail: '',
      projet: { type: 'AUCUN' },
      api: null,
    })

    expect(r.projet).toBeNull()
    expect(await prisma.externalLink.count({ where: { entityId: r.missionId } })).toBe(0)
  })

  it('ouvre un projet pour la mission, et crée le tiers s’il manque', async () => {
    // Refuser ici obligerait à sortir de la création de mission pour aller
    // rattacher le client dans les réglages, puis à y revenir.
    const client = await createClient('CMD SANS TIERS')
    const r = await creerMissionAvecProjet({
      userId,
      clientId: client.id,
      label: 'CMD Nouvelle',
      minutesParJour: null,
      signataireNom: '',
      signataireEmail: '',
      projet: { type: 'CREER' },
      api,
    })

    expect(r.tiersCree).toBe(true)
    expect(r.projetCree).toBe(true)
    expect(r.projet?.title).toBe('CMD Nouvelle')
    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_MISSION,
          entityId: r.missionId,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien?.externalId).toBe(String(r.projet?.id))
  })

  it('rattache un projet existant', async () => {
    const tiers = api.seedThirdparty('CMD ACME')
    const client = await createClient('CMD ACME local')
    await attachClient({ userId, clientId: client.id, dolibarrThirdpartyId: tiers.id })
    const projet = api.seedProject({ ref: 'PJ-EXISTANT', title: 'Déjà', socid: tiers.id })

    const r = await creerMissionAvecProjet({
      userId,
      clientId: client.id,
      label: 'CMD Rattachée',
      minutesParJour: null,
      signataireNom: '',
      signataireEmail: '',
      projet: {
        type: 'EXISTANT',
        projectId: projet.id,
        projectRef: projet.ref,
        projectSocid: projet.socid,
      },
      api,
    })

    expect(r.projetCree).toBe(false)
    expect(api.appels.createProject).toBe(0)
  })

  it('refuse le projet d’un autre tiers — et refuse avant de créer la mission', async () => {
    const tiers = api.seedThirdparty('CMD ACME')
    const autre = api.seedThirdparty('CMD AUTRE')
    const client = await createClient('CMD ACME local')
    await attachClient({ userId, clientId: client.id, dolibarrThirdpartyId: tiers.id })

    await expect(
      creerMissionAvecProjet({
        userId,
        clientId: client.id,
        label: 'CMD Refusée',
        minutesParJour: null,
        signataireNom: '',
        signataireEmail: '',
        projet: { type: 'EXISTANT', projectId: 999, projectRef: 'PJ-X', projectSocid: autre.id },
        api,
      }),
    ).rejects.toThrow(/mauvais client/i)

    expect(await prisma.mission.count({ where: { label: 'CMD Refusée' } })).toBe(0)
  })

  it('refuse d’ouvrir un projet quand Dolibarr n’est pas connecté', async () => {
    const client = await createClient('CMD ACME local')
    await expect(
      creerMissionAvecProjet({
        userId,
        clientId: client.id,
        label: 'CMD Sans Doli',
        minutesParJour: null,
        signataireNom: '',
        signataireEmail: '',
        projet: { type: 'CREER' },
        api: null,
      }),
    ).rejects.toThrow(/pas connecté/i)
    expect(await prisma.mission.count({ where: { label: 'CMD Sans Doli' } })).toBe(0)
  })
})

describe('attachOrderLine', () => {
  it('reprend les jours vendus et le TJM de la ligne de commande', async () => {
    const { tiersId, missionId } = await contexte()
    const ligne = await createLine({ missionId, label: 'Consultant', userId, soldCentiemes: 0, tjmCents: 0 })
    const commande = api.seedOrder({
      ref: 'CO2608-0049',
      socid: tiersId,
      lines: [{ label: 'Consultant ITSM', qty: 7.35, subpriceCents: 80_000 }],
    })

    const r = await attachOrderLine({
      userId,
      lineId: ligne.id,
      orderId: commande.id,
      orderLineId: commande.lines[0]!.id,
      api,
    })

    expect(r).toEqual({ soldCentiemes: 735, tjmCents: 80_000 })
    const enBase = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(enBase.soldCentiemes).toBe(735)
    expect(enBase.tjmCents).toBe(80_000)
    expect(enBase.engagementSource).toBe('DOLIBARR_COMMANDE')

    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_COMMANDE,
          entityId: ligne.id,
          provider: DOLIBARR,
        },
      },
    })
    expect(lien?.externalId).toBe(`${commande.id}:${commande.lines[0]!.id}`)
  })

  it('refuse une prestation qui n’est pas affectée au demandeur', async () => {
    const { tiersId, missionId } = await contexte()
    const ligne = await createLine({ missionId, label: 'Consultant', userId, soldCentiemes: 0, tjmCents: 0 })
    const commande = api.seedOrder({
      ref: 'CO2608-0050',
      socid: tiersId,
      lines: [{ label: 'Consultant', qty: 10, subpriceCents: 50_000 }],
    })

    await expect(
      attachOrderLine({
        userId: autreUserId,
        lineId: ligne.id,
        orderId: commande.id,
        orderLineId: commande.lines[0]!.id,
        api,
      }),
    ).rejects.toThrow(/affectée/i)

    // Et rien n'a été lu chez Dolibarr : une garde qui parle après coup a déjà
    // interrogé l'instance pour un demandeur sans droit.
    expect(api.appels.getOrder).toBe(0)
  })

  it('verrouille les chiffres repris : ils ne se modifient plus localement', async () => {
    // Le verrou du service testait « est-ce une propale ? ». Une prestation
    // reprise d'une commande redevenait modifiable, et ses jours vendus
    // pouvaient diverger du document — sur les chiffres qui seront facturés.
    const { tiersId, missionId } = await contexte()
    const ligne = await createLine({
      missionId,
      label: 'Consultant',
      userId,
      soldCentiemes: 0,
      tjmCents: 0,
    })
    const commande = api.seedOrder({
      ref: 'CO2608-0052',
      socid: tiersId,
      lines: [{ label: 'Consultant', qty: 10, subpriceCents: 50_000 }],
    })
    await attachOrderLine({
      userId,
      lineId: ligne.id,
      orderId: commande.id,
      orderLineId: commande.lines[0]!.id,
      api,
    })

    const refus = await updateLine({ userId, lineId: ligne.id, soldCentiemes: 4000 })
    expect(refus).toEqual({
      ok: false,
      reason: 'ENGAGEMENT_EXTERNE',
      // Le document est nommé : « la propale » enverrait chercher au mauvais
      // endroit.
      message: expect.stringContaining('commande Dolibarr'),
    })

    const relue = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(relue.soldCentiemes).toBe(1000)
  })

  it('refuse une ligne absente de la commande sans rien écrire', async () => {
    const { tiersId, missionId } = await contexte()
    const ligne = await createLine({ missionId, label: 'Consultant', userId, soldCentiemes: 0, tjmCents: 0 })
    const commande = api.seedOrder({ ref: 'CO2608-0051', socid: tiersId, lines: [] })

    await expect(
      attachOrderLine({ userId, lineId: ligne.id, orderId: commande.id, orderLineId: 999, api }),
    ).rejects.toThrow(/introuvable/i)

    const enBase = await prisma.missionLine.findUniqueOrThrow({ where: { id: ligne.id } })
    expect(enBase.engagementSource).toBe('MANUEL')
  })
})
