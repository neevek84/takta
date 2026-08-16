import { prisma } from '@/db/client'
import { CalendarApiError, type CalendarConnector } from '@/core/calendar/connector'
import { buildCalendarEvent } from '@/core/calendar/event'
import { abandon, nextAttempt, PROVIDER_GOOGLE, type ConflictKind } from '@/core/sync/policy'
import type { TimeEntryKind } from '@/core/types'
import type { FetchLike } from '@/integrations/google/calendar'
import { getSettings } from '@/services/settings'
import { toIsoDate } from '@/services/time-entries'
import { resolveConnector, TIME_ZONE } from './connector'

export interface FlushReport {
  /** aucun compte joignable : rien n'a été tenté, rien n'a été marqué en échec */
  nonConnecte: boolean
  traitees: number
  reussies: number
  conflits: number
  echecs: number
}

type Row = Awaited<ReturnType<typeof prisma.syncOutbox.findFirstOrThrow>>

function cibleDe(row: Row) {
  return { entityType: row.entityType, entityId: row.entityId, provider: row.provider }
}

/** Message d'échec borné : la colonne n'est pas un journal d'exécution. */
function messageDe(err: unknown): string {
  const brut = err instanceof Error ? err.message : String(err)
  return brut.slice(0, 500)
}

/**
 * Ouvre — ou rafraîchit — la divergence à arbitrer.
 *
 * Idempotent par construction : tant qu'un conflit reste ouvert sur la même
 * cible, on le met à jour au lieu d'en empiler un second. Un écran d'arbitrage
 * qui listerait dix fois la même divergence ne serait pas arbitrable.
 */
async function ouvrirConflit(row: Row, kind: ConflictKind, snapshot: unknown): Promise<void> {
  const ouvert = await prisma.syncConflict.findFirst({
    where: { userId: row.userId, ...cibleDe(row), resolvedAt: null },
  })
  const data = { kind, remoteSnapshotJson: JSON.stringify(snapshot), detectedAt: new Date() }

  if (ouvert === null) {
    await prisma.syncConflict.create({ data: { userId: row.userId, ...cibleDe(row), ...data } })
  } else {
    await prisma.syncConflict.update({ where: { id: ouvert.id }, data })
  }
}

type Issue = 'OK' | 'CONFLIT'

async function traiterUpsert(connector: CalendarConnector, row: Row, now: Date): Promise<Issue> {
  const entry = await prisma.timeEntry.findFirst({
    where: { id: row.entityId, userId: row.userId },
    include: { line: { include: { mission: { include: { client: true } } } } },
  })
  // La saisie a disparu entre la mise en file et le drainage : plus rien à
  // pousser. La ligne DELETE, elle, aura été mise en file par la suppression.
  if (entry === null) return 'OK'

  const settings = await getSettings()
  const draft = buildCalendarEvent({
    entryId: entry.id,
    date: toIsoDate(entry.date),
    minutes: entry.minutes,
    kind: entry.kind as TimeEntryKind,
    clientName: entry.line.mission.client.name,
    missionLabel: entry.line.mission.label,
    lineLabel: entry.line.label,
    slot: entry.slotId === '' ? null : (settings.slots.find((s) => s.id === entry.slotId) ?? null),
    journeeDebutMinute: settings.journeeDebutMinute,
    journeeFinMinute: settings.journeeFinMinute,
    timeZone: TIME_ZONE,
  })

  const link = await prisma.externalLink.findUnique({
    where: { entityType_entityId_provider: cibleDe(row) },
  })

  if (link === null) {
    const cree = await connector.createEvent(draft)
    await prisma.externalLink.create({
      data: {
        ...cibleDe(row),
        externalId: cree.externalId,
        etag: cree.etag,
        syncState: 'SYNCED',
        syncedAt: now,
      },
    })
    return 'OK'
  }

  // On lit avant d'écrire. C'est le seul moment où une modification faite dans
  // Google peut être vue — et le seul endroit où on peut refuser de l'écraser.
  let remote
  try {
    remote = await connector.getEvent(link.externalId)
  } catch (err) {
    if (err instanceof CalendarApiError && err.kind === 'NOT_FOUND') {
      await ouvrirConflit(row, 'REMOTE_DELETED', { externalId: link.externalId })
      return 'CONFLIT'
    }
    throw err
  }

  if (link.etag !== '' && remote.etag !== link.etag) {
    await ouvrirConflit(row, 'REMOTE_MODIFIED', remote)
    // Et surtout : aucune écriture. La divergence part en arbitrage.
    return 'CONFLIT'
  }

  const maj = await connector.updateEvent(link.externalId, draft)
  await prisma.externalLink.update({
    where: { id: link.id },
    data: { etag: maj.etag, syncState: 'SYNCED', syncedAt: now },
  })
  return 'OK'
}

async function traiterSuppression(connector: CalendarConnector, row: Row): Promise<Issue> {
  const link = await prisma.externalLink.findUnique({
    where: { entityType_entityId_provider: cibleDe(row) },
  })
  // Jamais poussée, donc rien à retirer de l'agenda.
  if (link === null) return 'OK'

  // Un événement déjà absent est absorbé par le connecteur : l'objectif est
  // atteint, la ligne peut être consommée.
  await connector.deleteEvent(link.externalId)
  await prisma.externalLink.delete({ where: { id: link.id } })
  return 'OK'
}

export async function flushSyncOutbox(args: {
  userId: string
  limit?: number
  now?: Date
  /** injecté par les tests ; `null` force le cas « non connecté » */
  connector?: CalendarConnector | null
  fetchFn?: FetchLike
}): Promise<FlushReport> {
  const now = args.now ?? new Date()
  const vide: FlushReport = {
    nonConnecte: true,
    traitees: 0,
    reussies: 0,
    conflits: 0,
    echecs: 0,
  }

  const connector =
    args.connector !== undefined
      ? args.connector
      : await resolveConnector(args.userId, {
          ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
          now,
        })

  // Rien n'est marqué en échec : un compte non connecté n'est pas une panne de
  // synchronisation, et consommer des tentatives ici viderait le quota avant
  // même que l'utilisateur ait connecté son agenda.
  if (connector === null) return vide

  // `nextAttemptAt` porte un **recul après échec**, pas une date d'ouverture :
  // une ligne jamais tentée est due par définition, quelle que soit l'horloge.
  // La mise en file, elle, estampille avec l'horloge système ; comparer les
  // deux rendrait la file inerte dès que l'appelant fournit un autre instant
  // (drainage d'une reprise, test à horloge figée) — et rien ne l'aurait dit,
  // puisqu'une file inerte ne lève rien.
  const rows = await prisma.syncOutbox.findMany({
    where: {
      userId: args.userId,
      state: 'PENDING',
      OR: [{ attempts: 0 }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: args.limit ?? 50,
  })

  const report: FlushReport = {
    nonConnecte: false,
    traitees: 0,
    reussies: 0,
    conflits: 0,
    echecs: 0,
  }

  for (const row of rows) {
    report.traitees += 1
    try {
      const issue =
        row.operation === 'DELETE'
          ? await traiterSuppression(connector, row)
          : await traiterUpsert(connector, row, now)

      if (issue === 'CONFLIT') report.conflits += 1
      else report.reussies += 1

      // Conflit compris : la ligne quitte la file, le conflit porte désormais
      // l'état. Sans cela, chaque passage rouvrirait la même divergence.
      await prisma.syncOutbox.delete({ where: { id: row.id } })
    } catch (err) {
      // Un refus définitif ne se rejoue pas : il part directement en `FAILED`,
      // où l'écran de synchronisation le montrera une fois au lieu de cinq.
      const definitif = err instanceof CalendarApiError && err.kind === 'INVALID'
      const suite = definitif ? abandon(row.attempts, now) : nextAttempt(row.attempts, now)
      await prisma.syncOutbox.update({
        where: { id: row.id },
        data: {
          attempts: suite.attempts,
          state: suite.state,
          nextAttemptAt: suite.nextAttemptAt,
          lastError: messageDe(err),
        },
      })
      if (suite.state === 'FAILED') report.echecs += 1
    }
  }

  return report
}

/**
 * Nombre maximal de passes par compte et par déclenchement.
 *
 * `flushSyncOutbox` traite au plus `limit` lignes et ne s'enchaîne pas : sans
 * reprise, un déclenchement laisserait derrière lui tout ce qui dépasse, et
 * une file de 200 lignes attendrait quatre déclenchements pour partir. La
 * borne, elle, garde la main : au-delà de 20 × 50 lignes en un seul passage,
 * ce n'est plus un retard mais un défaut, et boucler sans fin sur un compte
 * priverait tous les suivants de leur drainage.
 */
const MAX_PASSES = 20

/**
 * Draine la file de chaque compte connecté. C'est ce que l'endpoint interne
 * appelle : il n'a pas de session, donc pas d'utilisateur courant.
 */
export async function flushAllSyncOutboxes(
  limit = 50,
  /** injectées par les tests ; la production n'en passe aucune */
  deps: { now?: Date; fetchFn?: FetchLike } = {},
): Promise<{ comptes: number; traitees: number }> {
  const now = deps.now ?? new Date()
  const comptes = await prisma.providerCredential.findMany({
    where: { provider: PROVIDER_GOOGLE, calendarId: { not: '' } },
    select: { userId: true },
  })

  let traitees = 0
  for (const compte of comptes) {
    // Résolu une fois par compte, pas une fois par passe : un jeton
    // rafraîchi vingt fois de suite ferait vingt appels à Google pour rien.
    const connector = await resolveConnector(compte.userId, {
      ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
      now,
    })
    if (connector === null) continue

    for (let passe = 0; passe < MAX_PASSES; passe++) {
      const r = await flushSyncOutbox({ userId: compte.userId, limit, now, connector })
      traitees += r.traitees
      // Une passe non pleine a vu le fond de la file : la suivante ne
      // trouverait que des lignes reculées après échec, pas encore dues.
      if (r.traitees < limit) break
    }
  }

  return { comptes: comptes.length, traitees }
}
