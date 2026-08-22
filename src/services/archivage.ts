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
import {
  LIEN_COMMANDE,
  LIEN_LIGNE,
  LIEN_MISSION,
  LIEN_PROPALE,
  LIEN_TEMPS,
  LIEN_TEMPS_REPRIS,
  SEPARATEUR,
} from './dolibarr/liens'

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


/**
 * Ce que la suppression d'une **prestation** détruirait.
 *
 * Type distinct d'`ImpactSuppression` parce que les gestes ne sont pas
 * emboîtés : supprimer une prestation ne détruit **aucun** CRA — le CRA porte
 * un mois de mission, pas une prestation. Réutiliser le compteur `cras` d'une
 * suppression de mission ferait donc annoncer une destruction qui n'a pas
 * lieu, et taire celle qui a lieu vraiment : le contenu d'un mois déjà validé
 * change.
 */
export interface ImpactSuppressionPrestation {
  saisies: number
  /**
   * Parmi elles, celles qui tombent dans un mois **déjà validé**. Ce sont les
   * seules qui engagent : un mois validé a été envoyé au client, parfois
   * signé, et son contenu ne concorde plus après coup.
   */
  saisiesValidees: number
  /** CRA validés dont le contenu changerait. Ils ne sont **pas** détruits. */
  crasValides: number
  /** correspondances Dolibarr rompues au passage */
  correspondances: number
}

const VIDE_PRESTATION: ImpactSuppressionPrestation = {
  saisies: 0,
  saisiesValidees: 0,
  crasValides: 0,
  correspondances: 0,
}

/** Le mois d'une date, `'YYYY-MM'` — la granularité d'un CRA. */
function mois(date: Date): string {
  return date.toISOString().slice(0, 7)
}

/** Les correspondances qu'une prestation porte, directement ou par ses saisies. */
async function correspondancesDeLaPrestation(
  lineId: string,
  saisies: Array<{ id: string }>,
  cras: Array<{ id: string }>,
): Promise<number> {
  const directes = await prisma.externalLink.count({
    where: {
      provider: DOLIBARR,
      OR: [
        // La tâche du projet, et les deux engagements repris : une prestation
        // porte jusqu'à trois correspondances sous son seul identifiant.
        { entityType: { in: [LIEN_LIGNE, LIEN_PROPALE, LIEN_COMMANDE] }, entityId: lineId },
        { entityType: LIEN_TEMPS_REPRIS, entityId: { in: saisies.map((s) => s.id) } },
      ],
    },
  })

  // Les cellules poussées se lisent par préfixe : `craId|lineId|jour|creneau`.
  // Deux parts suffisent à isoler ce qui appartient à cette prestation, et
  // le reste du CRA — les cellules des autres prestations — reste intact.
  let cellules = 0
  for (const cra of cras) {
    cellules += await prisma.externalLink.count({
      where: {
        provider: DOLIBARR,
        entityType: LIEN_TEMPS,
        entityId: { startsWith: `${cra.id}${SEPARATEUR}${lineId}${SEPARATEUR}` },
      },
    })
  }
  return directes + cellules
}

/** Les saisies d'une prestation, les CRA de sa mission, et rien d'autre. */
async function contenuDeLaPrestation(lineId: string) {
  const ligne = await prisma.missionLine.findUnique({
    where: { id: lineId },
    select: { id: true, missionId: true },
  })
  if (ligne === null) return null

  const saisies = await prisma.timeEntry.findMany({
    where: { lineId },
    select: { id: true, userId: true, date: true },
  })
  const cras = await prisma.cra.findMany({
    where: { missionId: ligne.missionId },
    select: { id: true, userId: true, month: true, status: true },
  })
  return { ligne, saisies, cras }
}

/** Ce que la suppression d'une prestation détruirait. */
export async function impactSuppressionPrestation(
  lineId: string,
): Promise<ImpactSuppressionPrestation> {
  const contenu = await contenuDeLaPrestation(lineId)
  if (contenu === null) return VIDE_PRESTATION

  // Une saisie appartient au CRA de son auteur, pour le mois où elle tombe :
  // rapprocher sur le seul mois attribuerait à un consultant le CRA validé
  // d'un autre, et ferait crier au loup sur une mission partagée.
  const valides = contenu.cras.filter((c) => c.status === 'VALIDE')
  const touches = new Set<string>()
  let saisiesValidees = 0
  for (const saisie of contenu.saisies) {
    const cra = valides.find((c) => c.userId === saisie.userId && mois(c.month) === mois(saisie.date))
    if (cra === undefined) continue
    saisiesValidees += 1
    touches.add(cra.id)
  }

  return {
    saisies: contenu.saisies.length,
    saisiesValidees,
    crasValides: touches.size,
    correspondances: await correspondancesDeLaPrestation(lineId, contenu.saisies, contenu.cras),
  }
}

/**
 * Refusé faute d'affectation, comme `updateLine` : sans affectation, la
 * prestation n'est pas la sienne, et il ne range ni ne détruit le travail d'un
 * autre consultant.
 */
export type PrestationRefus = { ok: false; reason: 'NON_AFFECTE' }

/**
 * Range une prestation, ou la sort de l'archive. Réversible, rien n'est perdu.
 *
 * Le verrou d'engagement de `updateLine` ne s'applique pas : il porte sur les
 * jours vendus et le TJM, dont Dolibarr est maître. Ranger ne touche à aucun
 * des deux — et une prestation reprise d'une propale close resterait sinon
 * dans la grille de saisie pour toujours.
 */
export async function archiverPrestation(args: {
  userId: string
  lineId: string
  archive: boolean
}): Promise<{ ok: true } | PrestationRefus> {
  const affectation = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: { id: true },
  })
  if (affectation === null) return { ok: false, reason: 'NON_AFFECTE' }

  await prisma.missionLine.update({
    where: { id: args.lineId },
    data: { archived: args.archive },
  })
  return { ok: true }
}

/**
 * Détruit une prestation, ses saisies et son affectation — **localement**.
 *
 * Les correspondances partent d'abord, pour la raison qui vaut déjà pour la
 * mission : `ExternalLink.entityId` est une chaîne nue, sans clé étrangère, et
 * la cascade de la base ne l'emporte pas. Une correspondance survivante
 * désignerait le vide, et la prochaine prestation à recevoir le même
 * identifiant hériterait de la tâche d'une autre.
 *
 * **Rien n'est refusé quand les saisies sont déjà parties chez Dolibarr : elles
 * sont comptées.** C'est ce que fait déjà la suppression d'une mission, qui
 * emporte des CRA validés après les avoir comptés. Refuser ici et accepter un
 * niveau au-dessus pousserait à supprimer la mission entière pour se
 * débarrasser d'une prestation — un geste bien plus destructeur pour la même
 * intention. Et rien n'est supprimé chez Dolibarr : ce qui y a été poussé est
 * l'historique du client, parfois déjà facturé, dont le porteur fait le ménage
 * à la main.
 */
export async function supprimerPrestation(args: {
  userId: string
  lineId: string
}): Promise<{ ok: true; impact: ImpactSuppressionPrestation } | PrestationRefus> {
  const affectation = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: { id: true },
  })
  if (affectation === null) return { ok: false, reason: 'NON_AFFECTE' }

  const impact = await impactSuppressionPrestation(args.lineId)
  const contenu = await contenuDeLaPrestation(args.lineId)
  if (contenu === null) return { ok: false, reason: 'NON_AFFECTE' }

  await prisma.$transaction(async (tx) => {
    await tx.externalLink.deleteMany({
      where: {
        provider: DOLIBARR,
        OR: [
          { entityType: { in: [LIEN_LIGNE, LIEN_PROPALE, LIEN_COMMANDE] }, entityId: args.lineId },
          {
            entityType: LIEN_TEMPS_REPRIS,
            entityId: { in: contenu.saisies.map((s) => s.id) },
          },
        ],
      },
    })
    for (const cra of contenu.cras) {
      await tx.externalLink.deleteMany({
        where: {
          provider: DOLIBARR,
          entityType: LIEN_TEMPS,
          entityId: { startsWith: `${cra.id}${SEPARATEUR}${args.lineId}${SEPARATEUR}` },
        },
      })
    }
    // La file aussi : une ligne qui vise une saisie détruite ne pourra jamais
    // aboutir, et elle resterait à réessayer indéfiniment dans la supervision.
    await tx.syncOutbox.deleteMany({
      where: { entityId: { in: contenu.saisies.map((s) => s.id) } },
    })
    // Les saisies et l'affectation partent en cascade — elles, la base les
    // relie vraiment.
    await tx.missionLine.delete({ where: { id: args.lineId } })
  })

  return { ok: true, impact }
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
