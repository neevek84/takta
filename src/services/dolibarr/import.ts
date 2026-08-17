import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission } from '@/services/missions'
import { verifierCoherenceTiers } from '@/core/dolibarr/coherence'
import { DOLIBARR, type DolibarrApi } from './api'
import { LIEN_MISSION, rompreLiensDerives, type LienDolibarr } from './liens'
import { rattraperCraValides } from './rattrapage'

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
 * Ce qu'un rattachement de projet a réellement fait — au-delà de la
 * correspondance qu'il pose.
 *
 * Les trois nombres existent pour être **dits à l'écran**. Une rupture de
 * correspondances dérivées et une mise en file d'historique sont des effets
 * qu'un rattachement « réussi » ne laisse pas deviner, et qui décident de ce
 * qui partira, ou non, chez le client.
 */
export interface AttachMissionResult {
  /** la mission pointait déjà sur un **autre** projet */
  repointage: boolean
  /** correspondances `prestation → tâche` rompues par le repointage */
  lignes: number
  /** correspondances `cellule → temps consommé` rompues par le repointage */
  temps: number
  /** CRA déjà validés remis en file pour ce rattachement */
  craRattrapes: number
}

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
 *
 * Exporté : la reprise de propale (`./propal.ts`) doit comparer exactement le
 * même tiers attendu que le rattachement des projets. Deux lectures parallèles
 * de la même correspondance finiraient par diverger.
 */
export async function tiersAttendu(clientId: string): Promise<number | null> {
  const lien = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: { entityType: 'Client', entityId: clientId, provider: DOLIBARR },
    },
    select: { externalId: true },
  })
  return lien === null ? null : Number(lien.externalId)
}

/**
 * Le projet Dolibarr auquel une mission est rattachée, ou `null`.
 *
 * Lu avant tout rattachement : c'est ce qui permet de reconnaître un
 * **repointage** — un rattachement vers un autre projet que celui d'hier — du
 * simple réenregistrement du même.
 */
async function projetRattache(missionId: string): Promise<string | null> {
  const lien = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_MISSION,
        entityId: missionId,
        provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })
  return lien?.externalId ?? null
}

/**
 * Rattache une mission existante à un projet Dolibarr.
 *
 * Refuse si le tiers du projet (`projectSocid`) ne correspond pas au tiers
 * déjà rattaché au client de la mission : rien n'empêcherait sinon de
 * rattacher le projet du tiers A à une mission du client B, et les temps
 * poussés atterriraient chez le mauvais client.
 *
 * **Un repointage rompt les correspondances dérivées.** Rattacher ailleurs
 * sans les rompre ne changeait rien du tout : le push retrouvait les tâches de
 * l'ancien projet et continuait d'y déverser les temps — le nouveau projet
 * restait vide, et le refus de cohérence ne pouvait rien y voir puisqu'il ne
 * s'exécute qu'ici. Le compte rendu dit combien de correspondances sont
 * tombées : une rupture silencieuse laisserait croire que rien n'a bougé.
 */
export async function attachMission(args: {
  userId: string
  missionId: string
  dolibarrProjectId: number
  /** référence du projet Dolibarr, pour nommer un éventuel refus */
  projectRef: string
  /** tiers auquel Dolibarr rattache le projet ; null si le projet n'en porte aucun */
  projectSocid: number | null
}): Promise<AttachMissionResult> {
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

  const precedent = await projetRattache(args.missionId)
  const repointage = precedent !== null && precedent !== String(args.dolibarrProjectId)
  const rupture = repointage
    ? await rompreLiensDerives(args.missionId)
    : { lignes: 0, temps: 0 }

  await poser({
    userId: args.userId,
    entityType: LIEN_MISSION,
    entityId: args.missionId,
    externalId: String(args.dolibarrProjectId),
  })

  return { repointage, ...rupture, craRattrapes: await rattraperCraValides(args.missionId) }
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
    entityType: LIEN_MISSION,
    entityId: m.id,
    externalId: String(args.dolibarrProjectId),
  })
  // Aucun rattrapage ni aucune rupture à annoncer : une mission qui vient de
  // naître n'a ni prestation, ni CRA, ni correspondance dérivée.
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
 *
 * **Les cinq natures, pas deux.** Le connecteur en pose cinq ; la rupture n'en
 * connaissait que deux, et les trois autres — `MissionLine`,
 * `MissionLinePropalLine`, `CraTimeSpent` — n'avaient aucun chemin de rupture,
 * ni par l'interface ni par un service. La promesse citée juste au-dessus était
 * donc fausse pour la majorité d'entre elles, et un repointage de mission
 * n'était réparable qu'en base. `LienDolibarr` ferme la liste : une sixième
 * nature ne compilera pas sans passer par ici.
 *
 * **Détacher une mission rompt ce qu'elle a engendré.** Garder les tâches et
 * les temps de l'ancien projet après avoir rompu le projet lui-même ne laisse
 * que des correspondances orphelines, qui redeviendraient actives au premier
 * rattachement suivant — vers un autre projet, donc vers les mauvaises tâches.
 *
 * `userId` n'est pas un filtre, et ne peut pas l'être : ces correspondances
 * sont de portée instance, posées par l'écran d'administration pour tout le
 * monde. Il reste la trace de qui a demandé la rupture.
 */
export async function detachEntity(args: {
  userId: string
  entityType: LienDolibarr
  entityId: string
}): Promise<void> {
  if (args.entityType === LIEN_MISSION) await rompreLiensDerives(args.entityId)

  await prisma.externalLink.deleteMany({
    where: { entityType: args.entityType, entityId: args.entityId, provider: DOLIBARR },
  })
}
