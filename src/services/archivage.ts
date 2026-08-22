/**
 * Ranger ou détruire une mission, un client.
 *
 * **Trois gestes, et ils ne sont pas interchangeables.**
 *
 * *Détacher* rompt le lien avec Dolibarr et ne perd rien : la mission redevient
 * locale, ses saisies restent. C'est le geste qui convient quand le projet
 * distant a disparu — ce que Dolibarr ne dit à personne, et qui laisse
 * l'application pousser dans le vide.
 *
 * *Archiver* range : la mission sort des listes, ses temps ne se saisissent
 * plus, et tout reste lisible. C'est réversible.
 *
 * *Supprimer* détruit, et ne se rattrape pas. Les saisies, les CRA — signés
 * compris — et les correspondances partent avec. L'impact est donc **compté
 * avant**, et l'écran le montre : un compte rendu après coup ne sert plus à
 * rien.
 *
 * **Rien n'est jamais supprimé chez Dolibarr.** Ce qui y a été poussé est
 * l'historique du client, parfois déjà facturé, et l'application n'en est pas
 * maîtresse. Supprimer ici laisse là-bas intact — c'est déjà la promesse que
 * porte `detachEntity`.
 */
import { prisma } from '@/db/client'
import { DOLIBARR } from './dolibarr/api'
import { LIEN_MISSION, LIEN_TEMPS, LIEN_TEMPS_REPRIS, LIEN_LIGNE, SEPARATEUR } from './dolibarr/liens'

/** Ce qu'une suppression emporte, compté avant de la proposer. */
export interface ImpactSuppression {
  prestations: number
  saisies: number
  cras: number
  /**
   * CRA **validés**. Comptés à part parce qu'ils ne sont pas du brouillon :
   * un mois validé a été envoyé au client, parfois signé, et sa disparition
   * efface la seule trace locale de ce qui a été facturé.
   */
  crasValides: number
  /** correspondances Dolibarr rompues au passage */
  correspondances: number
}

const VIDE: ImpactSuppression = {
  prestations: 0,
  saisies: 0,
  cras: 0,
  crasValides: 0,
  correspondances: 0,
}

/** Les identifiants locaux qu'une mission entraîne dans sa chute. */
async function contenuDeLaMission(missionId: string) {
  const lignes = await prisma.missionLine.findMany({
    where: { missionId },
    select: { id: true },
  })
  const cras = await prisma.cra.findMany({ where: { missionId }, select: { id: true, status: true } })
  const saisies = await prisma.timeEntry.findMany({
    where: { lineId: { in: lignes.map((l) => l.id) } },
    select: { id: true },
  })
  return { lignes, cras, saisies }
}

/**
 * Compte les correspondances Dolibarr qu'une mission porte, directement ou par
 * ce qu'elle contient.
 *
 * Les cellules poussées ne se lisent que par préfixe : leur `entityId` porte
 * quatre parts dont le `craId` en tête, et un `in` est impossible.
 */
async function correspondancesDeLaMission(
  missionId: string,
  contenu: Awaited<ReturnType<typeof contenuDeLaMission>>,
): Promise<number> {
  const directes = await prisma.externalLink.count({
    where: {
      provider: DOLIBARR,
      OR: [
        { entityType: LIEN_MISSION, entityId: missionId },
        { entityType: LIEN_LIGNE, entityId: { in: contenu.lignes.map((l) => l.id) } },
        { entityType: LIEN_TEMPS_REPRIS, entityId: { in: contenu.saisies.map((s) => s.id) } },
      ],
    },
  })

  let cellules = 0
  for (const cra of contenu.cras) {
    cellules += await prisma.externalLink.count({
      where: {
        provider: DOLIBARR,
        entityType: LIEN_TEMPS,
        entityId: { startsWith: `${cra.id}${SEPARATEUR}` },
      },
    })
  }
  return directes + cellules
}

/** Ce que la suppression d'une mission détruirait. */
export async function impactSuppressionMission(missionId: string): Promise<ImpactSuppression> {
  const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { id: true } })
  if (mission === null) return VIDE

  const contenu = await contenuDeLaMission(missionId)
  return {
    prestations: contenu.lignes.length,
    saisies: contenu.saisies.length,
    cras: contenu.cras.length,
    crasValides: contenu.cras.filter((c) => c.status === 'VALIDE').length,
    correspondances: await correspondancesDeLaMission(missionId, contenu),
  }
}

/** Range une mission, ou la sort de l'archive. Réversible, rien n'est perdu. */
export async function archiverMission(missionId: string, archive: boolean): Promise<void> {
  await prisma.mission.update({ where: { id: missionId }, data: { archived: archive } })
}

/**
 * Détruit une mission et tout ce qu'elle contient — **localement**.
 *
 * Les correspondances partent d'abord : elles ne sont reliées à rien par une
 * clé étrangère (`entityId` est une chaîne nue), donc la cascade de la base ne
 * les emporterait pas. Elles survivraient à ce qu'elles désignent, et la
 * prochaine mission à recevoir le même identifiant hériterait de la
 * correspondance d'une autre.
 */
export async function supprimerMission(missionId: string): Promise<ImpactSuppression> {
  const impact = await impactSuppressionMission(missionId)
  const contenu = await contenuDeLaMission(missionId)

  await prisma.$transaction(async (tx) => {
    await tx.externalLink.deleteMany({
      where: {
        provider: DOLIBARR,
        OR: [
          { entityType: LIEN_MISSION, entityId: missionId },
          { entityType: LIEN_LIGNE, entityId: { in: contenu.lignes.map((l) => l.id) } },
          { entityType: LIEN_TEMPS_REPRIS, entityId: { in: contenu.saisies.map((s) => s.id) } },
        ],
      },
    })
    for (const cra of contenu.cras) {
      await tx.externalLink.deleteMany({
        where: {
          provider: DOLIBARR,
          entityType: LIEN_TEMPS,
          entityId: { startsWith: `${cra.id}${SEPARATEUR}` },
        },
      })
    }
    // La file aussi : une ligne qui vise un CRA détruit ne pourra jamais
    // aboutir, et elle resterait à réessayer indéfiniment dans la supervision.
    await tx.syncOutbox.deleteMany({
      where: {
        OR: [
          { entityId: { in: contenu.cras.map((c) => c.id) } },
          { entityId: { in: contenu.saisies.map((s) => s.id) } },
        ],
      },
    })
    await tx.mission.delete({ where: { id: missionId } })
  })

  return impact
}

/** Ce que la suppression d'un client détruirait, ses missions comprises. */
export async function impactSuppressionClient(clientId: string): Promise<ImpactSuppression> {
  const missions = await prisma.mission.findMany({ where: { clientId }, select: { id: true } })

  const total = { ...VIDE }
  for (const m of missions) {
    const impact = await impactSuppressionMission(m.id)
    total.prestations += impact.prestations
    total.saisies += impact.saisies
    total.cras += impact.cras
    total.crasValides += impact.crasValides
    total.correspondances += impact.correspondances
  }
  return total
}

export async function archiverClient(clientId: string, archive: boolean): Promise<void> {
  await prisma.client.update({ where: { id: clientId }, data: { archived: archive } })
}

/**
 * Détruit un client et toutes ses missions.
 *
 * Mission par mission, et non par une cascade de la base : c'est le seul moyen
 * d'emporter les correspondances, que la base ne relie à rien.
 */
export async function supprimerClient(clientId: string): Promise<ImpactSuppression> {
  const missions = await prisma.mission.findMany({ where: { clientId }, select: { id: true } })

  const total = { ...VIDE }
  for (const m of missions) {
    const impact = await supprimerMission(m.id)
    total.prestations += impact.prestations
    total.saisies += impact.saisies
    total.cras += impact.cras
    total.crasValides += impact.crasValides
    total.correspondances += impact.correspondances
  }

  await prisma.$transaction(async (tx) => {
    await tx.externalLink.deleteMany({
      where: { provider: DOLIBARR, entityType: 'Client', entityId: clientId },
    })
    await tx.client.delete({ where: { id: clientId } })
  })

  return total
}

/** Ce que l'écran de gestion des données montre, archivé compris. */
export interface Inventaire {
  clients: Array<{
    id: string
    name: string
    archived: boolean
    missions: number
    /** rattaché à un tiers Dolibarr : ce n'est alors pas un client « local » */
    dansDolibarr: boolean
  }>
  missionsArchivees: Array<{ id: string; label: string; clientName: string }>
}

/**
 * Clients et missions archivées, **sans filtrer sur l'utilisateur**.
 *
 * C'est un écran d'administration : il montre l'état de l'instance, pas la vue
 * d'un consultant. Un client rangé par quelqu'un d'autre doit pouvoir être
 * ressorti — sans quoi il serait rangé pour toujours.
 */
export async function inventaire(): Promise<Inventaire> {
  const clients = await prisma.client.findMany({
    orderBy: [{ archived: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, archived: true, _count: { select: { missions: true } } },
  })
  const liens = await prisma.externalLink.findMany({
    where: { provider: DOLIBARR, entityType: 'Client', entityId: { in: clients.map((c) => c.id) } },
    select: { entityId: true },
  })
  const rattaches = new Set(liens.map((l) => l.entityId))

  const missionsArchivees = await prisma.mission.findMany({
    where: { archived: true },
    orderBy: { label: 'asc' },
    select: { id: true, label: true, client: { select: { name: true } } },
  })

  return {
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      archived: c.archived,
      missions: c._count.missions,
      dansDolibarr: rattaches.has(c.id),
    })),
    missionsArchivees: missionsArchivees.map((m) => ({
      id: m.id,
      label: m.label,
      clientName: m.client.name,
    })),
  }
}
