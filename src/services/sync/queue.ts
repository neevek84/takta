import { prisma } from '@/db/client'
import { ENTITY_TIME_ENTRY, type SyncOperation } from '@/core/sync/policy'
import { toIsoDate } from '@/services/time-entries'

export interface FailedSyncRow {
  id: string
  entityId: string
  /** ce que la ligne visait : 'TimeEntry', 'Cra'… */
  entityType: string
  /** vers qui elle partait — l'écran est commun à tous les fournisseurs */
  provider: string
  operation: SyncOperation
  attempts: number
  lastError: string
  /** ce que la ligne visait, pour que l'écran soit lisible */
  libelle: string
}

/**
 * Les lignes tombées en échec, qui **remontent** dans l'écran de
 * synchronisation au lieu de disparaître.
 *
 * Ce module vit à part d'`outbox.ts` pour une raison mécanique : le libellé a
 * besoin de `toIsoDate`, donc de `@/services/time-entries`, qui importe déjà
 * `enqueueTimeEntry` depuis `outbox.ts`. En aval des deux et importé par aucun,
 * `queue.ts` ne ferme aucun cycle.
 */
export async function listFailedSyncRows(userId: string): Promise<FailedSyncRow[]> {
  const rows = await prisma.syncOutbox.findMany({
    where: { userId, state: 'FAILED' },
    orderBy: { updatedAt: 'desc' },
  })
  if (rows.length === 0) return []

  // La recherche est bornée aux lignes qui visent réellement une saisie.
  // Toutes ne le font plus : la file est commune à tous les fournisseurs, et
  // celles qui partent vers Dolibarr désignent un CRA. Chercher leur `cuid`
  // dans `TimeEntry` ne rendait rien, et l'écran les annonçait « Saisie
  // supprimée » — un CRA validé, bien vivant, présenté comme effacé.
  const saisies = rows.filter((r) => r.entityType === ENTITY_TIME_ENTRY)
  const entries =
    saisies.length === 0
      ? []
      : await prisma.timeEntry.findMany({
          where: { userId, id: { in: saisies.map((r) => r.entityId) } },
          include: { line: { include: { mission: { include: { client: true } } } } },
        })
  const parId = new Map(entries.map((e) => [e.id, e]))

  return rows.map((r) => {
    const entry = parId.get(r.entityId)
    return {
      id: r.id,
      entityId: r.entityId,
      entityType: r.entityType,
      provider: r.provider,
      operation: r.operation as SyncOperation,
      attempts: r.attempts,
      lastError: r.lastError,
      libelle:
        entry !== undefined
          ? `${toIsoDate(entry.date)} · ${entry.line.mission.client.name} · ${entry.line.mission.label} · ${entry.line.label}`
          : r.entityType === ENTITY_TIME_ENTRY
            ? 'Saisie supprimée'
            : `${r.entityType} · ${r.entityId}`,
    }
  })
}

/**
 * Une ligne **en attente**, telle que l'écran de supervision la montre.
 *
 * L'écran ne montrait que les échecs. Or une file qui ne part pas ne produit
 * aucun échec : elle reste pleine, en silence, et rien ne le disait — c'est
 * dans cet angle mort qu'un CRA validé peut attendre des semaines.
 *
 * **La file est de portée instance, et c'est délibéré.** Un CRA appartient à
 * une mission, et le pousser est un acte d'instance : la clé d'API l'est, la
 * correspondance mission → projet l'est. Filtrer sur « qui a créé la ligne »
 * était le mauvais axe — arbitrage rendu par le porteur le 20 août 2026. La
 * restriction viendra des **rôles**, quand ils existeront : un consultant ne
 * verra alors que les missions qui le concernent, un administrateur tout.
 * D'ici là, une session authentifiée voit et force tout : ne pas remettre un
 * filtre par `userId` en croyant réparer un oubli.
 */
export interface PendingSyncRow {
  id: string
  entityId: string
  /** à qui appartient la ligne — ce que les rôles exploiteront demain */
  proprietaire: string
  entityType: string
  provider: string
  operation: SyncOperation
  /** depuis quand elle attend, en heures pleines */
  attenteHeures: number
  attempts: number
  libelle: string
}

/**
 * Ce qui attend de partir, du plus ancien au plus récent.
 *
 * L'ordre n'est pas cosmétique : c'est la ligne la plus vieille qui dit depuis
 * quand plus rien ne s'écoule.
 */
export async function listPendingSyncRows(): Promise<PendingSyncRow[]> {
  const rows = await prisma.syncOutbox.findMany({
    where: { state: 'PENDING' },
    orderBy: { updatedAt: 'asc' },
  })
  if (rows.length === 0) return []

  const saisies = rows.filter((r) => r.entityType === ENTITY_TIME_ENTRY)
  // Sans filtre sur `userId` : la saisie est cherchée par son identifiant, qui
  // est unique. La borner au demandeur ferait afficher « Saisie supprimée » sur
  // la ligne bien vivante d'un autre.
  const entries =
    saisies.length === 0
      ? []
      : await prisma.timeEntry.findMany({
          where: { id: { in: saisies.map((r) => r.entityId) } },
          include: { line: { include: { mission: { include: { client: true } } } } },
        })
  const proprietaires = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, name: true, email: true },
      })
    ).map((u) => [u.id, u.name === '' ? u.email : u.name]),
  )
  const parId = new Map(entries.map((e) => [e.id, e]))
  const maintenant = Date.now()

  return rows.map((r) => {
    const entry = parId.get(r.entityId)
    return {
      id: r.id,
      entityId: r.entityId,
      proprietaire: proprietaires.get(r.userId) ?? r.userId,
      entityType: r.entityType,
      provider: r.provider,
      operation: r.operation as SyncOperation,
      attenteHeures: Math.max(0, Math.floor((maintenant - r.updatedAt.getTime()) / 3_600_000)),
      attempts: r.attempts,
      libelle:
        entry !== undefined
          ? `${toIsoDate(entry.date)} · ${entry.line.mission.client.name} · ${entry.line.mission.label} · ${entry.line.label}`
          : r.entityType === ENTITY_TIME_ENTRY
            ? 'Saisie supprimée'
            : `${r.entityType} · ${r.entityId}`,
    }
  })
}

/**
 * Remet une ligne en attente immédiate. Rend `false` si elle n'existe pas.
 *
 * **Aucun filtre par utilisateur**, pour la même raison que la lecture : la
 * file est de portée instance. Une session authentifiée suffit aujourd'hui ;
 * les rôles poseront demain la vraie restriction.
 */
export async function retrySyncRow(rowId: string): Promise<boolean> {
  const r = await prisma.syncOutbox.updateMany({
    where: { id: rowId },
    data: { state: 'PENDING', attempts: 0, lastError: '', nextAttemptAt: new Date() },
  })
  return r.count > 0
}
