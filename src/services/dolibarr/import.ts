import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission } from '@/services/missions'
import { verifierCoherenceTiers } from '@/core/dolibarr/coherence'
import { DOLIBARR, type DolibarrApi } from './api'

export interface RemoteThirdparty {
  id: number
  name: string
  /** objet local rattaché, null si aucun */
  clientId: string | null
  /** null aussi quand le client rattaché n'est pas visible par l'utilisateur */
  clientName: string | null
}

export interface RemoteProject {
  id: number
  ref: string
  title: string
  socid: number | null
  missionId: string | null
  /** null aussi quand la mission rattachée n'est pas visible par l'utilisateur */
  missionLabel: string | null
}

export interface ImportCandidates {
  tiers: RemoteThirdparty[]
  projets: RemoteProject[]
}

/** Les deux natures d'objet que cet écran sait rattacher. */
export type ImportEntityType = 'Client' | 'Mission'

/**
 * Correspondances existantes d'un type d'entité, indexées par identifiant
 * distant.
 *
 * **Sans filtre sur `userId`, délibérément.** L'unicité de `ExternalLink` porte
 * sur `(entityType, entityId, provider)` : une correspondance appartient à
 * l'instance, pas à celui qui l'a posée — c'est déjà la lecture que fait
 * `sync/flush.ts`. Filtrer ici afficherait « non rattaché » un projet qu'un
 * autre consultant a déjà pris, et le rattachement suivant écraserait sa
 * correspondance au lieu d'en créer une.
 */
async function liensParExternalId(entityType: ImportEntityType): Promise<Map<string, string>> {
  const liens = await prisma.externalLink.findMany({
    where: { entityType, provider: DOLIBARR },
    select: { entityId: true, externalId: true },
  })
  return new Map(liens.map((l) => [l.externalId, l.entityId]))
}

async function poser(args: {
  userId: string
  entityType: ImportEntityType
  entityId: string
  externalId: string
}): Promise<void> {
  const { userId, entityType, entityId, externalId } = args
  await prisma.externalLink.upsert({
    where: { entityType_entityId_provider: { entityType, entityId, provider: DOLIBARR } },
    create: {
      // `userId` est obligatoire au schéma : c'est l'auteur du rattachement, et
      // la colonne qu'indexe toute reprise par compte.
      userId,
      entityType,
      entityId,
      provider: DOLIBARR,
      externalId,
      syncedAt: new Date(),
      syncState: 'SYNCED',
    },
    update: { externalId, syncedAt: new Date(), syncState: 'SYNCED' },
  })
}

/**
 * Ce que l'écran d'import affiche : les tiers et projets de Dolibarr, avec la
 * mention de l'objet local déjà rattaché quand il y en a un.
 *
 * Volontairement manuel (spec §7) : un import automatique aveugle produirait
 * des doublons sur une base qui contient déjà des clients saisis à la main.
 *
 * Une panne remonte telle quelle : une liste vide se confondrait avec
 * « Dolibarr n'a rien à proposer », et l'écran inviterait à tout recréer.
 */
export async function listImportCandidates(
  userId: string,
  api: DolibarrApi,
): Promise<ImportCandidates> {
  const [tiersDistants, projetsDistants] = await Promise.all([
    api.listThirdparties(),
    api.listProjects(),
  ])

  const [liensClients, liensMissions] = await Promise.all([
    liensParExternalId('Client'),
    liensParExternalId('Mission'),
  ])

  // Les libellés restent scopés comme partout ailleurs : un consultant voit
  // qu'un projet est pris, jamais sous quel nom un autre l'a rangé.
  const clients = await prisma.client.findMany({
    where: {
      id: { in: [...liensClients.values()] },
      OR: [
        { missions: { none: {} } },
        { missions: { some: { lines: { none: {} } } } },
        { missions: { some: { lines: { some: { assignments: { some: { userId } } } } } } },
      ],
    },
    select: { id: true, name: true },
  })
  const nomClient = new Map(clients.map((c) => [c.id, c.name]))

  const missions = await prisma.mission.findMany({
    where: {
      id: { in: [...liensMissions.values()] },
      OR: [{ lines: { none: {} } }, { lines: { some: { assignments: { some: { userId } } } } }],
    },
    select: { id: true, label: true },
  })
  const nomMission = new Map(missions.map((m) => [m.id, m.label]))

  return {
    tiers: tiersDistants.map((t) => {
      const clientId = liensClients.get(String(t.id)) ?? null
      return {
        id: t.id,
        name: t.name,
        clientId,
        clientName: clientId === null ? null : (nomClient.get(clientId) ?? null),
      }
    }),
    projets: projetsDistants.map((p) => {
      const missionId = liensMissions.get(String(p.id)) ?? null
      return {
        id: p.id,
        ref: p.ref,
        title: p.title,
        socid: p.socid,
        missionId,
        missionLabel: missionId === null ? null : (nomMission.get(missionId) ?? null),
      }
    }),
  }
}

export async function attachClient(args: {
  userId: string
  clientId: string
  dolibarrThirdpartyId: number
}): Promise<void> {
  await poser({
    userId: args.userId,
    entityType: 'Client',
    entityId: args.clientId,
    externalId: String(args.dolibarrThirdpartyId),
  })
}

export async function createClientFromDolibarr(args: {
  userId: string
  dolibarrThirdpartyId: number
  name: string
}): Promise<{ clientId: string }> {
  const c = await createClient(args.name)
  await poser({
    userId: args.userId,
    entityType: 'Client',
    entityId: c.id,
    externalId: String(args.dolibarrThirdpartyId),
  })
  return { clientId: c.id }
}

/**
 * Le tiers Dolibarr déjà rattaché à un client local, ou `null` si ce client
 * n'est rattaché à aucun tiers.
 *
 * Filtré sur `provider: DOLIBARR` pour la même raison que
 * `liensParExternalId` : `ExternalLink` est générique depuis la tâche 6.
 */
async function tiersAttendu(clientId: string): Promise<number | null> {
  const lien = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: { entityType: 'Client', entityId: clientId, provider: DOLIBARR },
    },
    select: { externalId: true },
  })
  return lien === null ? null : Number(lien.externalId)
}

/**
 * Rattache une mission existante à un projet Dolibarr.
 *
 * Refuse si le tiers du projet (`projectSocid`) ne correspond pas au tiers
 * déjà rattaché au client de la mission : rien n'empêcherait sinon de
 * rattacher le projet du tiers A à une mission du client B, et la demande de
 * facture partirait chez le mauvais client une fois les temps poussés.
 */
export async function attachMission(args: {
  userId: string
  missionId: string
  dolibarrProjectId: number
  /** référence du projet Dolibarr, pour nommer un éventuel refus */
  projectRef: string
  /** tiers auquel Dolibarr rattache le projet ; null si le projet n'en porte aucun */
  projectSocid: number | null
}): Promise<void> {
  const mission = await prisma.mission.findUniqueOrThrow({
    where: { id: args.missionId },
    select: { client: { select: { id: true, name: true } } },
  })

  verifierCoherenceTiers({
    projectRef: args.projectRef,
    projectSocid: args.projectSocid,
    clientLabel: mission.client.name,
    expectedThirdpartyId: await tiersAttendu(mission.client.id),
  })

  await poser({
    userId: args.userId,
    entityType: 'Mission',
    entityId: args.missionId,
    externalId: String(args.dolibarrProjectId),
  })
}

/**
 * Crée une mission locale sous un client existant, à partir d'un projet
 * Dolibarr — même refus de cohérence qu'`attachMission`, et vérifié **avant**
 * de créer quoi que ce soit : un refus après coup laisserait une mission
 * orpheline, jamais rattachée, mais bien réelle en base.
 */
export async function createMissionFromDolibarr(args: {
  userId: string
  clientId: string
  dolibarrProjectId: number
  /** référence du projet Dolibarr, pour nommer un éventuel refus */
  projectRef: string
  /** tiers auquel Dolibarr rattache le projet ; null si le projet n'en porte aucun */
  projectSocid: number | null
  label: string
}): Promise<{ missionId: string }> {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: args.clientId },
    select: { name: true },
  })

  verifierCoherenceTiers({
    projectRef: args.projectRef,
    projectSocid: args.projectSocid,
    clientLabel: client.name,
    expectedThirdpartyId: await tiersAttendu(args.clientId),
  })

  const m = await createMission({ clientId: args.clientId, label: args.label })
  await poser({
    userId: args.userId,
    entityType: 'Mission',
    entityId: m.id,
    externalId: String(args.dolibarrProjectId),
  })
  return { missionId: m.id }
}

/**
 * Pousse un client local vers Dolibarr. Idempotent : si la correspondance
 * existe déjà, on la rend telle quelle plutôt que de créer un second tiers.
 *
 * L'appel distant précède l'écriture locale : en cas de panne, rien n'est
 * inscrit, et l'utilisateur peut réessayer sans avoir à nettoyer un lien
 * pointant vers un tiers qui n'existe pas.
 */
export async function pushClientToDolibarr(args: {
  userId: string
  clientId: string
  api: DolibarrApi
}): Promise<{ dolibarrThirdpartyId: number }> {
  const existant = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: 'Client',
        entityId: args.clientId,
        provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })
  if (existant !== null) return { dolibarrThirdpartyId: Number(existant.externalId) }

  const client = await prisma.client.findUniqueOrThrow({
    where: { id: args.clientId },
    select: { name: true },
  })
  const tiers = await args.api.createThirdparty(client.name)
  await poser({
    userId: args.userId,
    entityType: 'Client',
    entityId: args.clientId,
    externalId: String(tiers.id),
  })

  return { dolibarrThirdpartyId: tiers.id }
}

/**
 * Rompt une correspondance sans rien supprimer des deux côtés. Toute référence
 * externe est nullable à tout moment (spec §1) — c'est ce qui préserve
 * l'autoportance de l'application.
 */
export async function detachEntity(args: {
  userId: string
  entityType: ImportEntityType
  entityId: string
}): Promise<void> {
  await prisma.externalLink.deleteMany({
    where: { entityType: args.entityType, entityId: args.entityId, provider: DOLIBARR },
  })
}
