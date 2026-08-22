/**
 * Reprendre en prestations les tâches d'un projet Dolibarr déjà en cours.
 *
 * **À quoi ça sert.** Le flux normal descend de la commande : elle porte ses
 * lignes de service, chacune devient une prestation, chaque prestation ouvre sa
 * tâche. Une mission qu'on rattache à un projet **déjà vivant** n'a rien de tout
 * cela — le projet existe, ses tâches existent, et l'application n'en sait rien.
 * Sans reprise, le porteur ressaisirait à la main ce que Dolibarr sait déjà, et
 * le push créerait des tâches en double à côté de celles qui portent l'histoire.
 *
 * **Ce que la reprise ne fait jamais.** Elle ne touche à rien chez Dolibarr :
 * aucune tâche créée, renommée ni supprimée. Elle ne fait que poser, côté
 * application, les prestations et les correspondances qui manquaient.
 */
import { prisma } from '@/db/client'
import { joursVendusDepuisCharge } from '@/core/dolibarr/timespent'
import { resolveMinutesParJour } from '@/core/rates/cascade'
import { createLine } from '@/services/missions'
import { getSettings } from '@/services/settings'
import { DOLIBARR, type DolibarrApi } from './api'
import { LIEN_LIGNE } from './liens'
import { projetDeLaMission } from './taches'

/** Une tâche du projet, telle que l'écran de conversion la présente. */
export interface TacheReprenable {
  taskId: number
  /** référence Dolibarr, `TK2608-0042` */
  ref: string
  label: string
  /** jours vendus déduits de `planned_workload`, en centièmes de jour */
  joursVendusCentiemes: number
  /**
   * La tâche ne porte aucune charge prévue : les jours vendus valent zéro et
   * ils sont **à renseigner**. Signalé plutôt que tu, sans quoi un trou
   * passerait pour une mesure et le reste à consommer serait faux sans le dire.
   */
  sansCharge: boolean
  /** la prestation qui vise déjà cette tâche, `null` si aucune */
  dejaLiee: { lineId: string; label: string } | null
}

/** Une prestation de la mission, telle que l'appariement la propose. */
export interface PrestationAppariable {
  lineId: string
  label: string
  /** elle vise déjà une tâche : l'apparier ailleurs romprait ce lien */
  dejaLiee: boolean
}

export interface EtatReprise {
  /** projet Dolibarr rattaché à la mission, `null` s'il n'y en a pas */
  projectId: number | null
  taches: TacheReprenable[]
  prestations: PrestationAppariable[]
}

/** Ce que le porteur décide, tâche par tâche. */
export type DecisionReprise =
  | { taskId: number; action: 'CREER' }
  | { taskId: number; action: 'APPARIER'; lineId: string }
  | { taskId: number; action: 'IGNORER' }

export interface RepriseEffectuee {
  creees: number
  appariees: number
  ignorees: number
  /** prestations créées sans jours vendus, à compléter à la main */
  sansCharge: number
  /**
   * Décisions écartées, et pourquoi — une tâche déjà reprise, une prestation
   * déjà prise par une autre tâche. Rendues plutôt que tues : une reprise
   * silencieusement partielle est pire qu'une reprise qui refuse.
   */
  ecartees: string[]
}

/** Le facteur de la mission, prestation exclue : la tâche n'en a pas encore. */
async function facteurDeLaMission(missionId: string): Promise<number> {
  const mission = await prisma.mission.findUniqueOrThrow({
    where: { id: missionId },
    select: { minutesParJour: true, client: { select: { minutesParJour: true } } },
  })
  const settings = await getSettings()
  return resolveMinutesParJour({
    line: null,
    mission: mission.minutesParJour,
    client: mission.client.minutesParJour,
    global: settings.minutesParJour,
  })
}

/** `taskId` → prestation qui le vise, pour les prestations de cette mission. */
async function liensDeLaMission(
  missionId: string,
): Promise<{ parTache: Map<number, { lineId: string; label: string }>; parLigne: Set<string> }> {
  const lignes = await prisma.missionLine.findMany({
    where: { missionId, archived: false },
    select: { id: true, label: true },
  })
  const liens = await prisma.externalLink.findMany({
    where: {
      provider: DOLIBARR,
      entityType: LIEN_LIGNE,
      entityId: { in: lignes.map((l) => l.id) },
    },
    select: { entityId: true, externalId: true },
  })

  const labelParLigne = new Map(lignes.map((l) => [l.id, l.label]))
  const parTache = new Map<number, { lineId: string; label: string }>()
  const parLigne = new Set<string>()
  for (const lien of liens) {
    const taskId = Number(lien.externalId)
    if (!Number.isFinite(taskId)) continue
    parTache.set(taskId, { lineId: lien.entityId, label: labelParLigne.get(lien.entityId) ?? '' })
    parLigne.add(lien.entityId)
  }
  return { parTache, parLigne }
}

/**
 * Ce que l'écran de conversion a besoin de montrer : les tâches du projet, ce
 * qui est déjà repris, et les prestations auxquelles on peut les apparier.
 *
 * Rend un état vide plutôt que de lever quand la mission n'a pas de projet ou
 * que Dolibarr n'est pas connecté : il n'y a alors rien à reprendre, ce n'est
 * pas une panne.
 */
export async function tachesReprenables(args: {
  missionId: string
  api: DolibarrApi | null
}): Promise<EtatReprise> {
  const projectId = await projetDeLaMission(args.missionId)
  if (args.api === null || projectId === null) {
    return { projectId: null, taches: [], prestations: [] }
  }

  const [taches, { parTache, parLigne }, minutesParJour] = await Promise.all([
    args.api.listTasks(projectId),
    liensDeLaMission(args.missionId),
    facteurDeLaMission(args.missionId),
  ])

  const prestations = await prisma.missionLine.findMany({
    where: { missionId: args.missionId, archived: false },
    select: { id: true, label: true },
    orderBy: { position: 'asc' },
  })

  return {
    projectId,
    taches: taches.map((t) => ({
      taskId: t.id,
      ref: t.ref,
      label: t.label,
      joursVendusCentiemes: joursVendusDepuisCharge({
        plannedWorkloadSeconds: t.plannedWorkloadSeconds,
        minutesParJour,
      }),
      sansCharge: t.plannedWorkloadSeconds === null,
      dejaLiee: parTache.get(t.id) ?? null,
    })),
    prestations: prestations.map((p) => ({
      lineId: p.id,
      label: p.label,
      dejaLiee: parLigne.has(p.id),
    })),
  }
}

/**
 * Applique les décisions du porteur.
 *
 * **Rien n'est écrit chez Dolibarr.** Créer une prestation ici ne crée pas de
 * tâche : la tâche existe, c'est tout le propos. La correspondance est posée
 * `SYNCED`, non `PENDING`, parce qu'il n'y a rien à pousser — les deux côtés
 * sont déjà d'accord.
 */
export async function reprendreLesTaches(args: {
  missionId: string
  userId: string
  decisions: DecisionReprise[]
  api: DolibarrApi | null
}): Promise<RepriseEffectuee> {
  const resultat: RepriseEffectuee = {
    creees: 0,
    appariees: 0,
    ignorees: 0,
    sansCharge: 0,
    ecartees: [],
  }

  const projectId = await projetDeLaMission(args.missionId)
  if (args.api === null || projectId === null) {
    resultat.ecartees.push(
      "La mission n'est rattachée à aucun projet Dolibarr : il n'y a pas de tâche à reprendre.",
    )
    return resultat
  }

  const taches = await args.api.listTasks(projectId)
  const parId = new Map(taches.map((t) => [t.id, t]))
  const { parTache, parLigne } = await liensDeLaMission(args.missionId)
  const minutesParJour = await facteurDeLaMission(args.missionId)

  for (const decision of args.decisions) {
    if (decision.action === 'IGNORER') {
      resultat.ignorees += 1
      continue
    }

    const tache = parId.get(decision.taskId)
    if (tache === undefined) {
      resultat.ecartees.push(
        `La tâche n° ${decision.taskId} n'est plus dans le projet : elle a pu être supprimée ou déplacée depuis l'affichage de cet écran.`,
      )
      continue
    }

    // Une tâche déjà reprise ne se reprend pas deux fois : la seconde
    // prestation recevrait la même tâche, et les temps des deux partiraient au
    // même endroit sans que rien ne le dise.
    const deja = parTache.get(decision.taskId)
    if (deja !== undefined) {
      resultat.ecartees.push(
        `La tâche « ${tache.label} » est déjà reprise par la prestation « ${deja.label} ».`,
      )
      continue
    }

    if (decision.action === 'APPARIER') {
      // La contrainte d'unicité porte sur la prestation, pas sur la tâche :
      // apparier une prestation déjà liée **remplacerait** son lien en silence,
      // et ses temps déjà poussés viseraient soudain une autre tâche.
      if (parLigne.has(decision.lineId)) {
        resultat.ecartees.push(
          `La prestation visée est déjà rattachée à une autre tâche : « ${tache.label} » n'a pas été reprise.`,
        )
        continue
      }
      const prestation = await prisma.missionLine.findFirst({
        where: { id: decision.lineId, missionId: args.missionId, archived: false },
        select: { id: true },
      })
      if (prestation === null) {
        resultat.ecartees.push(
          `La prestation visée pour « ${tache.label} » n'appartient pas à cette mission.`,
        )
        continue
      }

      await lier(args.userId, decision.lineId, decision.taskId)
      parTache.set(decision.taskId, { lineId: decision.lineId, label: tache.label })
      parLigne.add(decision.lineId)
      resultat.appariees += 1
      continue
    }

    const joursVendusCentiemes = joursVendusDepuisCharge({
      plannedWorkloadSeconds: tache.plannedWorkloadSeconds,
      minutesParJour,
    })

    const prestation = await createLine({
      missionId: args.missionId,
      userId: args.userId,
      label: tache.label,
      soldCentiemes: joursVendusCentiemes,
      // Une tâche Dolibarr ne porte aucun prix : le TJM reste à zéro et il est
      // de toute façon informatif — l'application ne facture pas.
      tjmCents: 0,
    })

    await prisma.missionLine.update({
      where: { id: prestation.id },
      data: { engagementSource: 'DOLIBARR_PROJET' },
    })
    await lier(args.userId, prestation.id, decision.taskId)

    parTache.set(decision.taskId, { lineId: prestation.id, label: tache.label })
    parLigne.add(prestation.id)
    resultat.creees += 1
    if (tache.plannedWorkloadSeconds === null) resultat.sansCharge += 1
  }

  return resultat
}

/** Pose la correspondance prestation ↔ tâche, déjà synchronisée. */
async function lier(userId: string, lineId: string, taskId: number): Promise<void> {
  await prisma.externalLink.upsert({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_LIGNE,
        entityId: lineId,
        provider: DOLIBARR,
      },
    },
    create: {
      userId,
      entityType: LIEN_LIGNE,
      entityId: lineId,
      provider: DOLIBARR,
      externalId: String(taskId),
      syncedAt: new Date(),
      syncState: 'SYNCED',
    },
    update: { externalId: String(taskId), syncedAt: new Date(), syncState: 'SYNCED' },
  })
}
