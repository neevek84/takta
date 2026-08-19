import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine, updateLine } from '@/services/missions'
import { FakeDolibarr } from './fake'
import { DOLIBARR } from './api'
import { LIEN_COMMANDE, LIEN_MISSION } from './liens'
import { attachClient } from './import'
import { attachOrderLine, creerProjetDepuisCommande, listerCommandes } from './commande'

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
