import { z } from 'zod'
import { prisma } from '@/db/client'
import { engagementVerrouille, libelleEngagement } from '@/core/dolibarr/engagement'
import { getSettings } from './settings'
import { resolveMinutesParJour } from '@/core/rates/cascade'
import type { DisplayUnit, EngagementSource } from '@/core/types'
import { appendAudit, actorOf } from './audit'

export interface LineForGrid {
  id: string
  label: string
  missionLabel: string
  clientName: string
  displayUnit: DisplayUnit
  minutesParJour: number
  soldCentiemes: number
  allowedSlotIds: string[]
}

/**
 * `userId` optionnel, pour la même raison que sur `createClient` : une mission
 * se crée sans utilisateur dans des dizaines d'appels existants, et le journal
 * a besoin d'un acteur. Absent, l'acte revient à `SYSTEME` ; les server
 * actions le passent toujours.
 */
export async function createMission(args: {
  clientId: string
  label: string
  minutesParJour?: number | null
  signataireNom?: string
  signataireEmail?: string
  userId?: string
}): Promise<{ id: string }> {
  const m = await prisma.mission.create({
    data: {
      clientId: args.clientId,
      label: args.label,
      minutesParJour: args.minutesParJour ?? null,
      signataireNom: args.signataireNom ?? '',
      signataireEmail: args.signataireEmail ?? '',
    },
  })

  await appendAudit({
    ...(await actorOf(args.userId ?? '')),
    action: 'mission.creee',
    entityType: 'Mission',
    entityId: m.id,
    payload: {
      clientId: args.clientId,
      label: args.label,
      minutesParJour: args.minutesParJour ?? null,
    },
  })

  return { id: m.id }
}

export async function createLine(args: {
  missionId: string
  userId: string
  label: string
  soldCentiemes: number
  tjmCents: number
  displayUnit?: DisplayUnit
  minutesParJour?: number | null
  allowedSlotIds?: string[]
}): Promise<{ id: string }> {
  const settings = await getSettings()

  // Les deux écritures tiennent dans une seule transaction : une ligne sans
  // affectation n'existe pas dans le modèle — `listActiveLines` part des
  // affectations, donc une telle ligne serait invisible dans l'interface tout
  // en occupant la base, sans moyen de la supprimer.
  const cree = await prisma.$transaction(async (tx) => {
    const line = await tx.missionLine.create({
      data: {
        missionId: args.missionId,
        label: args.label,
        soldCentiemes: args.soldCentiemes,
        tjmCents: args.tjmCents,
        displayUnit: args.displayUnit ?? settings.defaultDisplayUnit,
        minutesParJour: args.minutesParJour ?? null,
        engagementSource: settings.defaultEngagementSource,
        allowedSlotIds: (args.allowedSlotIds ?? []).join(','),
      },
    })

    // Provision multi-consultants : l'affectation existe toujours, même à un seul.
    await tx.assignment.create({
      data: { lineId: line.id, userId: args.userId, soldCentiemes: args.soldCentiemes },
    })

    return { id: line.id }
  })

  // Hors de la transaction, et volontairement : le journal ne doit pas être
  // écrit dans une transaction qui peut encore être annulée — il attesterait
  // alors d'une prestation qui n'existe pas.
  await appendAudit({
    ...(await actorOf(args.userId)),
    action: 'prestation.creee',
    entityType: 'MissionLine',
    entityId: cree.id,
    payload: {
      missionId: args.missionId,
      label: args.label,
      soldCentiemes: args.soldCentiemes,
      tjmCents: args.tjmCents,
      displayUnit: args.displayUnit ?? settings.defaultDisplayUnit,
      minutesParJour: args.minutesParJour ?? null,
    },
  })

  return cree
}

export interface MissionForUser {
  id: string
  label: string
  clientId: string
  clientName: string
  /** durée d'une journée réellement appliquée, après cascade */
  minutesParJourEffectif: number
  /** surcharge portée par la mission elle-même, null si héritée */
  minutesParJourSurcharge: number | null
  /** contact signataire du CRA, porté par la mission et non par le client */
  signataireNom: string
  signataireEmail: string
  lines: Array<{
    id: string
    label: string
    soldCentiemes: number
    tjmCents: number
    displayUnit: DisplayUnit
    /**
     * D'où vient l'engagement de cette ligne. L'écran s'en sert pour ne pas
     * proposer de modifier des chiffres dont la source de vérité est ailleurs.
     */
    engagementSource: EngagementSource
  }>
}

/**
 * Une mission est visible pour un utilisateur si elle n'a encore aucune
 * ligne (fraîchement créée, pas encore revendiquée — sinon la création
 * d'une première ligne serait impossible sur une base vide), ou si
 * l'utilisateur a une affectation sur au moins une de ses lignes. Les
 * lignes renvoyées sont filtrées de la même façon : seules celles
 * affectées à l'utilisateur apparaissent (une mission partagée par
 * plusieurs consultants ne fuit pas les lignes des autres).
 */
export async function listMissionsForUser(userId: string): Promise<MissionForUser[]> {
  const [missions, settings] = await Promise.all([
    prisma.mission.findMany({
      where: {
        archived: false,
        OR: [{ lines: { none: {} } }, { lines: { some: { assignments: { some: { userId } } } } }],
      },
      include: {
        client: true,
        lines: { where: { archived: false, assignments: { some: { userId } } } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    getSettings(),
  ])

  return missions.map((m) => ({
    id: m.id,
    label: m.label,
    clientId: m.client.id,
    clientName: m.client.name,
    minutesParJourEffectif: resolveMinutesParJour({
      mission: m.minutesParJour,
      client: m.client.minutesParJour,
      global: settings.minutesParJour,
    }),
    minutesParJourSurcharge: m.minutesParJour,
    signataireNom: m.signataireNom,
    signataireEmail: m.signataireEmail,
    lines: m.lines.map((l) => ({
      id: l.id,
      label: l.label,
      soldCentiemes: l.soldCentiemes,
      tjmCents: l.tjmCents,
      displayUnit: l.displayUnit as DisplayUnit,
      engagementSource: l.engagementSource as EngagementSource,
    })),
  }))
}

export type UpdateLineResult =
  | { ok: true }
  | { ok: false; reason: 'ENGAGEMENT_EXTERNE'; message: string }
  | { ok: false; reason: 'NON_AFFECTE' }

/**
 * Modifie une prestation.
 *
 * Le verrou de lecture seule sur les lignes issues d'une propale vit **ici**,
 * dans le service, et pas dans l'écran : le formulaire n'est qu'un des
 * appelants possibles, et le serveur est la seule barrière qui compte.
 *
 * Le verrou ne porte que sur les deux chiffres dont la source de vérité est
 * chez Dolibarr — jours vendus et TJM. Le libellé, l'unité d'affichage et les
 * créneaux autorisés restent locaux et modifiables.
 *
 * Un refus refuse **tout** le patch, y compris ce qui aurait pu passer : un
 * enregistrement partiel laisserait croire que le reste est passé aussi.
 */
export async function updateLine(args: {
  userId: string
  lineId: string
  label?: string
  soldCentiemes?: number
  tjmCents?: number
  displayUnit?: DisplayUnit
  allowedSlotIds?: string[]
}): Promise<UpdateLineResult> {
  const affectation = await prisma.assignment.findUnique({
    where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
    select: { line: { select: { engagementSource: true, soldCentiemes: true, tjmCents: true } } },
  })
  if (affectation === null) return { ok: false, reason: 'NON_AFFECTE' }

  const ligne = affectation.line
  // Renvoyer la valeur affichée n'est pas la modifier : le formulaire repose
  // les deux champs à chaque soumission, y compris quand ils sont en lecture
  // seule. Comparer, plutôt que refuser toute présence, évite un refus devant
  // lequel l'utilisateur n'aurait rien changé.
  const toucheEngagement =
    (args.soldCentiemes !== undefined && args.soldCentiemes !== ligne.soldCentiemes) ||
    (args.tjmCents !== undefined && args.tjmCents !== ligne.tjmCents)

  const source = ligne.engagementSource as EngagementSource
  if (engagementVerrouille(source) && toucheEngagement) {
    return {
      ok: false,
      reason: 'ENGAGEMENT_EXTERNE',
      // Le document est **nommé** : « la propale » sur un engagement repris
      // d'une commande enverrait chercher au mauvais endroit.
      message:
        `Les jours vendus et le TJM de cette prestation proviennent de la ${libelleEngagement(source)} ` +
        'à laquelle elle est rattachée. Modifiez-les dans Dolibarr, qui en reste maître : ' +
        'l’application ne modifie jamais un document commercial.',
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.missionLine.update({
      where: { id: args.lineId },
      data: {
        ...(args.label !== undefined && { label: args.label }),
        ...(args.soldCentiemes !== undefined && { soldCentiemes: args.soldCentiemes }),
        ...(args.tjmCents !== undefined && { tjmCents: args.tjmCents }),
        ...(args.displayUnit !== undefined && { displayUnit: args.displayUnit }),
        ...(args.allowedSlotIds !== undefined && {
          allowedSlotIds: args.allowedSlotIds.join(','),
        }),
      },
    })

    // La part affectée suit les jours vendus : `createLine` les initialise
    // égaux, les laisser diverger ici ferait mentir l'engagement affiché.
    if (args.soldCentiemes !== undefined) {
      await tx.assignment.update({
        where: { lineId_userId: { lineId: args.lineId, userId: args.userId } },
        data: { soldCentiemes: args.soldCentiemes },
      })
    }
  })

  return { ok: true }
}

export type SignataireResult = { ok: true } | { ok: false; erreur: string }

const signataireSchema = z
  .object({ nom: z.string().trim(), email: z.string().trim() })
  .refine((v) => v.email === '' || z.string().email().safeParse(v.email).success, {
    message: 'L’adresse électronique du signataire est invalide.',
  })
  // Un nom sans adresse produirait un destinataire qu'on ne peut pas joindre,
  // et donc un bouton « Envoyer pour signature » qui semble prêt sans l'être.
  .refine((v) => !(v.nom !== '' && v.email === ''), {
    message: 'Une adresse électronique est requise dès qu’un nom de signataire est renseigné.',
  })

/**
 * Renseigne le contact signataire d'une mission.
 *
 * Scopé par affectation : sans ligne affectée à l'utilisateur, la mission
 * n'est pas la sienne et il ne décide pas à qui son CRA est envoyé.
 *
 * Le signataire est porté par la **mission** et non par le client : un même
 * client peut porter plusieurs missions avec des interlocuteurs différents —
 * un chef de projet pour l'une, un responsable de service pour l'autre.
 */
export async function updateMissionSignataire(
  userId: string,
  missionId: string,
  patch: { nom: string; email: string },
): Promise<SignataireResult> {
  const valide = signataireSchema.safeParse(patch)
  if (!valide.success) {
    return { ok: false, erreur: valide.error.issues[0]?.message ?? 'Signataire invalide.' }
  }

  const mission = await prisma.mission.findFirst({
    where: { id: missionId, lines: { some: { assignments: { some: { userId } } } } },
    select: { id: true },
  })
  if (mission === null) {
    return { ok: false, erreur: 'Cette mission ne vous est pas affectée.' }
  }

  await prisma.mission.update({
    where: { id: missionId },
    data: { signataireNom: valide.data.nom, signataireEmail: valide.data.email },
  })
  return { ok: true }
}

export async function listActiveLines(userId: string): Promise<LineForGrid[]> {
  const settings = await getSettings()

  const assignments = await prisma.assignment.findMany({
    where: { userId, line: { archived: false, mission: { archived: false } } },
    include: { line: { include: { mission: { include: { client: true } } } } },
    orderBy: [{ line: { position: 'asc' } }],
  })

  return assignments.map((a) => ({
    id: a.line.id,
    label: a.line.label,
    missionLabel: a.line.mission.label,
    clientName: a.line.mission.client.name,
    displayUnit: a.line.displayUnit as DisplayUnit,
    // La cascade complète, comme à l'écriture : afficher un facteur que le gel
    // ne figera pas ferait mentir chaque case du calendrier.
    minutesParJour: resolveMinutesParJour({
      line: a.line.minutesParJour,
      mission: a.line.mission.minutesParJour,
      client: a.line.mission.client.minutesParJour,
      global: settings.minutesParJour,
    }),
    soldCentiemes: a.soldCentiemes,
    allowedSlotIds: a.line.allowedSlotIds === '' ? [] : a.line.allowedSlotIds.split(','),
  }))
}
