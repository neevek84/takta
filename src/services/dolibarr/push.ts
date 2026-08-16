import { prisma } from '@/db/client'
import { isLocked } from '@/core/cra/state-machine'
import { buildTimeSpentPayloads, type PushableEntry } from '@/core/dolibarr/timespent'
import { ENTITY_CRA } from '@/core/sync/policy'
import type { CraStatus, TimeEntryKind } from '@/core/types'
import { getInstanceCredential } from '@/services/credentials'
import type { SyncHandler, SyncJob, SyncOutcome } from '@/services/sync/types'
import {
  DOLIBARR,
  DolibarrMappingError,
  DolibarrRequestError,
  DolibarrUnavailableError,
  type DolibarrApi,
} from './api'

/** Types d'entités portés par `ExternalLink` pour ce connecteur. */
const LIEN_MISSION = 'Mission'
const LIEN_LIGNE = 'MissionLine'
/**
 * Une correspondance par **cellule de grille**, pas par saisie : la clé est
 * `craId|lineId|date|slotId`. Une saisie supprimée puis ressaisie retombe donc
 * sur le même temps passé chez Dolibarr au lieu d'en créer un second, et le
 * préfixe `craId|` permet de retrouver d'un coup tout ce qui a été poussé pour
 * ce CRA — y compris ce qui n'a plus de saisie locale.
 *
 * C'est cette table qui porte **toute** l'idempotence du push : `addTimeSpent`
 * n'en a aucune côté Dolibarr, et deux appels produisent deux lignes de temps
 * consommé chez le client.
 */
const LIEN_TEMPS = 'CraTimeSpent'

/** Sépare les quatre parts de la clé de cellule. Aucun `cuid` n'en contient. */
const SEPARATEUR = '|'

export interface PushResult {
  poussees: number
  misesAJour: number
  supprimees: number
  tachesCreees: number
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * `llx_projet_task_time` porte un `fk_user` obligatoire : sans identifiant
 * d'utilisateur Dolibarr, aucun temps ne peut être enregistré. Le manque est
 * une erreur de configuration, pas une panne — rejouer n'y changerait rien,
 * d'où la `DolibarrMappingError` que le gestionnaire traduit en abandon.
 */
async function dolibarrUserId(): Promise<number> {
  const credential = await getInstanceCredential(DOLIBARR)
  const id = Number(credential?.metadata.dolibarrUserId ?? '')

  if (!Number.isInteger(id) || id <= 0) {
    throw new DolibarrMappingError(
      "Aucun utilisateur Dolibarr n'est renseigné : l'enregistrement d'un temps passé en exige un. " +
        'Renseignez-le dans Administration · Dolibarr.',
    )
  }
  return id
}

/**
 * Pousse les temps **réalisés** d'un CRA validé sur les tâches de son projet
 * Dolibarr, et retire de Dolibarr ce qui n'a plus de saisie locale.
 *
 * Scopé sur `userId` comme toute fonction de service : le CRA est lu sur le
 * couple `(id, userId)`, et les saisies sur le même `userId`. Un compte qui
 * pousse le CRA d'un autre ne trouve rien — ni à pousser, ni à retirer.
 *
 * Ne lève jamais pour dire « rien à faire » : un CRA absent, appartenant à
 * quelqu'un d'autre, ou rouvert entre la mise en file et le drainage rend un
 * résultat à zéro. Les seules levées sont des défauts de configuration
 * (`DolibarrMappingError`) et ce que Dolibarr refuse ou ne peut pas servir.
 */
export async function pushCraTimes(args: {
  userId: string
  craId: string
  api: DolibarrApi
}): Promise<PushResult> {
  const resultat: PushResult = { poussees: 0, misesAJour: 0, supprimees: 0, tachesCreees: 0 }

  const cra = await prisma.cra.findFirst({
    where: { id: args.craId, userId: args.userId },
    select: { id: true, missionId: true, month: true, status: true },
  })

  // CRA disparu, ou appartenant à quelqu'un d'autre : rien à pousser, et ce
  // n'est pas une panne. La ligne de file est consommée sans bruit.
  if (cra === null) return resultat

  // Rouvert entre la mise en file et le drainage. Le déclencheur est la
  // validation, et elle seule : pousser un brouillon enverrait à Dolibarr du
  // temps qui n'est pas arrêté, et — bien pire — la réconciliation retirerait
  // de Dolibarr les journées que l'utilisateur est justement en train de
  // corriger.
  if (!isLocked(cra.status as CraStatus)) return resultat

  // La correspondance mission → projet est de portée instance : elle est posée
  // par l'écran d'administration, pour tout le monde. On la lit donc par sa
  // clé d'unicité, sans filtre sur `userId` — le cloisonnement est déjà fait,
  // en amont, par la lecture du CRA : on n'arrive ici qu'avec le `missionId`
  // d'un CRA dont on a prouvé qu'il appartient à `args.userId`.
  const lienMission = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_MISSION,
        entityId: cra.missionId,
        provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })

  if (lienMission === null) {
    throw new DolibarrMappingError(
      "Cette mission n'est rattachée à aucun projet Dolibarr. " +
        'Rattachez-la dans Administration · Dolibarr avant de pousser ses temps.',
    )
  }

  const projectId = Number(lienMission.externalId)
  const dolUser = await dolibarrUserId()

  const debut = new Date(Date.UTC(cra.month.getUTCFullYear(), cra.month.getUTCMonth(), 1))
  const fin = new Date(Date.UTC(cra.month.getUTCFullYear(), cra.month.getUTCMonth() + 1, 1))

  // Un CRA porte une mission et un mois : les deux bornes sont dans la requête.
  // Sans le filtre de mission, le temps d'une autre mission du même mois
  // partirait sur ce projet-ci, et le client verrait facturé du temps passé
  // ailleurs.
  //
  // Le tri « réalisé seulement » n'est PAS répété ici : c'est
  // `buildTimeSpentPayloads` qui le porte, et le dupliquer laisserait les deux
  // règles diverger. Le prix est quelques lignes lues pour rien ; le gain est
  // qu'une journée repassée en prévisionnel emprunte exactement le même chemin
  // qu'une journée supprimée — elle disparaît des charges utiles, donc la
  // réconciliation la retire de Dolibarr.
  const rows = await prisma.timeEntry.findMany({
    where: {
      userId: args.userId,
      date: { gte: debut, lt: fin },
      line: { missionId: cra.missionId },
    },
    select: {
      id: true,
      lineId: true,
      date: true,
      slotId: true,
      minutes: true,
      kind: true,
      minutesParJour: true,
      comment: true,
      line: { select: { label: true } },
    },
  })

  const entries: PushableEntry[] = rows.map((r) => ({
    id: r.id,
    lineId: r.lineId,
    date: toIsoDate(r.date),
    slotId: r.slotId,
    minutes: r.minutes,
    kind: r.kind as TimeEntryKind,
    // Le facteur figé à l'écriture, jamais le réglage courant : un CRA validé
    // ne change pas de calcul parce que le réglage a bougé depuis.
    minutesParJour: r.minutesParJour,
    comment: r.comment,
  }))
  const labelParLigne = new Map(rows.map((r) => [r.lineId, r.line.label]))
  const payloads = buildTimeSpentPayloads(entries)

  const tacheParLigne = new Map<string, number>()

  /**
   * Une prestation se mappe sur une **tâche** du projet. Elle est adoptée si
   * une tâche du même libellé existe déjà — cas d'une base Dolibarr organisée
   * à la main — et créée sinon, une seule fois, le lien étant alors mémorisé.
   *
   * L'adoption se fait sur le libellé exact, jamais sur « la première tâche du
   * projet » : un projet en porte plusieurs, et imputer le développement sur
   * la tâche de pilotage ne se verrait nulle part.
   */
  async function tacheDe(lineId: string): Promise<number> {
    const connue = tacheParLigne.get(lineId)
    if (connue !== undefined) return connue

    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_LIGNE,
          entityId: lineId,
          provider: DOLIBARR,
        },
      },
      select: { externalId: true },
    })
    if (lien !== null) {
      const id = Number(lien.externalId)
      tacheParLigne.set(lineId, id)
      return id
    }

    const label = labelParLigne.get(lineId) ?? lineId
    const existantes = await args.api.listTasks(projectId)
    const deja = existantes.find((t) => t.label === label)
    const tache = deja ?? (await args.api.createTask({ projectId, label }))
    if (deja === undefined) resultat.tachesCreees += 1

    // Comme la correspondance mission → projet, celle-ci est de portée
    // instance : la prestation est la même pour tous ceux qui l'imputent. La
    // colonne `userId` d'`ExternalLink` est pourtant obligatoire (clé
    // étrangère et cascade posées à la revue du lot 1b) : on y met le
    // pousseur, et l'`update` ne la touche plus — le premier qui rattache la
    // ligne garde le lien. Si son compte disparaît, la cascade emporte la
    // correspondance et le push suivant réadopte la tâche par son libellé,
    // sans jamais en créer un doublon.
    await prisma.externalLink.upsert({
      where: {
        entityType_entityId_provider: {
          entityType: LIEN_LIGNE,
          entityId: lineId,
          provider: DOLIBARR,
        },
      },
      create: {
        userId: args.userId,
        entityType: LIEN_LIGNE,
        entityId: lineId,
        provider: DOLIBARR,
        externalId: String(tache.id),
        syncedAt: new Date(),
        syncState: 'SYNCED',
      },
      update: { externalId: String(tache.id), syncedAt: new Date(), syncState: 'SYNCED' },
    })

    tacheParLigne.set(lineId, tache.id)
    return tache.id
  }

  const liens = await prisma.externalLink.findMany({
    where: {
      userId: args.userId,
      entityType: LIEN_TEMPS,
      provider: DOLIBARR,
      entityId: { startsWith: `${cra.id}${SEPARATEUR}` },
    },
    select: { entityId: true, externalId: true },
  })
  const connus = new Map(liens.map((l) => [l.entityId, l.externalId]))
  const vus = new Set<string>()

  for (const p of payloads) {
    const cle = [cra.id, p.lineId, p.date, p.slotId].join(SEPARATEUR)
    vus.add(cle)

    const existant = connus.get(cle)

    if (existant === undefined) {
      const taskId = await tacheDe(p.lineId)
      const { timespentId } = await args.api.addTimeSpent({
        taskId,
        dolibarrUserId: dolUser,
        date: p.date,
        durationSeconds: p.durationSeconds,
        note: p.note,
      })

      // Écrit cellule par cellule, immédiatement après l'appel qui l'a
      // poussée. Grouper ces écritures en fin de push suffirait à dupliquer,
      // au premier rejeu, tout ce qui précède une panne de milieu de lot :
      // les temps seraient chez Dolibarr, sans aucune correspondance pour les
      // retrouver.
      await prisma.externalLink.create({
        data: {
          userId: args.userId,
          entityType: LIEN_TEMPS,
          entityId: cle,
          provider: DOLIBARR,
          externalId: `${taskId}:${timespentId}`,
          syncedAt: new Date(),
          syncState: 'SYNCED',
        },
      })
      resultat.poussees += 1
    } else {
      const [taskId, timespentId] = existant.split(':').map(Number) as [number, number]
      await args.api.updateTimeSpent({
        taskId,
        timespentId,
        date: p.date,
        durationSeconds: p.durationSeconds,
        note: p.note,
      })
      await prisma.externalLink.updateMany({
        where: { entityType: LIEN_TEMPS, entityId: cle, provider: DOLIBARR },
        data: { syncedAt: new Date(), syncState: 'SYNCED' },
      })
      resultat.misesAJour += 1
    }
  }

  // Réconciliation. Sans elle, rouvrir un CRA, retirer une journée puis
  // revalider laisserait Dolibarr porter une journée qui n'existe plus.
  for (const [cle, externalId] of connus) {
    if (vus.has(cle)) continue

    const [taskId, timespentId] = externalId.split(':').map(Number) as [number, number]
    await args.api.deleteTimeSpent({ taskId, timespentId })
    // La correspondance disparaît avec le temps qu'elle désignait : la garder
    // ferait redemander la même suppression à chaque push, et une ressaisie de
    // la cellule ferait une mise à jour sur un identifiant mort.
    await prisma.externalLink.deleteMany({
      where: { entityType: LIEN_TEMPS, entityId: cle, provider: DOLIBARR },
    })
    resultat.supprimees += 1
  }

  return resultat
}

/**
 * Le gestionnaire que le drainage générique (`flushOutbox`) appelle pour les
 * lignes du fournisseur `DOLIBARR`.
 *
 * Il rend un verdict, il ne lève pas : c'est lui qui tranche entre « réessaie »
 * et « n'insiste pas ». Une exception qu'il ne sait pas qualifier remonte
 * intacte au drainage, qui la traite comme rejouable — mieux vaut cinq
 * tentatives qu'une ligne consommée sur un défaut qu'on n'a pas compris.
 */
export function createDolibarrHandler(api: DolibarrApi): SyncHandler {
  return {
    async upsert(job: SyncJob): Promise<SyncOutcome> {
      if (job.entityType !== ENTITY_CRA) {
        return {
          ok: false,
          retriable: false,
          message: `Le connecteur Dolibarr ne sait pas synchroniser « ${job.entityType} ».`,
        }
      }

      try {
        await pushCraTimes({ userId: job.userId, craId: job.entityId, api })
        return { ok: true }
      } catch (err) {
        if (err instanceof DolibarrUnavailableError) {
          return { ok: false, retriable: true, message: err.message }
        }
        // Correspondance absente ou requête refusée pour son contenu :
        // rejouer à l'identique n'aboutira jamais. La ligne part en `FAILED`
        // et remonte à l'écran de supervision au lieu d'y noyer les pannes
        // réelles sous cinq lignes de bruit.
        if (err instanceof DolibarrMappingError || err instanceof DolibarrRequestError) {
          return { ok: false, retriable: false, message: err.message }
        }
        throw err
      }
    },

    async remove(): Promise<SyncOutcome> {
      // L'application est maître du CRA : retirer des temps se fait en
      // rouvrant le CRA, pas en demandant une suppression à la file. Un
      // `DELETE` ne porte que l'identifiant d'un CRA disparu — il n'y a plus
      // ni mission, ni mois, ni saisies pour savoir quoi retirer.
      return {
        ok: false,
        retriable: false,
        message:
          'Le connecteur Dolibarr ne supprime pas de CRA : rouvrez le CRA, retirez les jours, ' +
          'puis revalidez — le push retire alors les temps correspondants.',
      }
    },
  }
}
