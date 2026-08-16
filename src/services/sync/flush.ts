import { prisma } from '@/db/client'
import { CalendarApiError, type CalendarConnector } from '@/core/calendar/connector'
import { buildCalendarEvent } from '@/core/calendar/event'
import {
  abandon,
  MAX_PASSES,
  nextAttempt,
  PROVIDER_GOOGLE,
  TAILLE_LOT,
  type ConflictKind,
} from '@/core/sync/policy'
import type { TimeEntryKind } from '@/core/types'
import type { FetchLike } from '@/integrations/google/calendar'
import { OWNER_SCOPE_USER } from '@/services/credentials'
import { getSettings } from '@/services/settings'
import { toIsoDate } from '@/services/time-entries'
import { resolveConnector } from './connector'

export interface FlushReport {
  /** aucun compte joignable : rien n'a été tenté, rien n'a été marqué en échec */
  nonConnecte: boolean
  traitees: number
  reussies: number
  conflits: number
  echecs: number
}

/**
 * Réexportée telle quelle : la constante a migré dans `core/sync/policy.ts`
 * pour que le drainage générique (`outbox.ts`) la lise sans fermer de cycle
 * d'imports. Les appelants historiques ne changent pas d'adresse.
 */
export { TAILLE_LOT }

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

async function traiterUpsert(
  connector: CalendarConnector,
  row: Row,
  now: Date,
  timeZone: string,
): Promise<Issue> {
  const entry = await prisma.timeEntry.findFirst({
    where: { id: row.entityId, userId: row.userId },
    include: { line: { include: { mission: { include: { client: true } } } } },
  })
  // La saisie a disparu entre la mise en file et le drainage : plus rien à
  // pousser. La ligne DELETE, elle, aura été mise en file par la suppression.
  if (entry === null) return 'OK'

  // Aucun réglage n'est relu ici, et c'est tout l'enjeu : les heures d'une
  // saisie sont figées à son écriture, et ce drainage les reportait autrefois
  // depuis `settings.slots` et la plage journée **courantes**. Un créneau
  // redéfini en administration déplaçait alors le bloc d'agenda d'une journée
  // que personne n'avait retouchée — CRA validé compris. La colonne en base
  // n'y aurait rien changé : le gel se casse en lecture.
  const draft = buildCalendarEvent({
    entryId: entry.id,
    date: toIsoDate(entry.date),
    kind: entry.kind as TimeEntryKind,
    clientName: entry.line.mission.client.name,
    missionLabel: entry.line.mission.label,
    lineLabel: entry.line.label,
    startMinute: entry.startMinute,
    endMinute: entry.endMinute,
    // Le fuseau, lui, est bien un réglage courant, et c'est voulu : il situe
    // des heures locales naïves, il ne les change pas. Il vient des réglages,
    // saisi à l'écran — plus de `CRA_TIMEZONE` dans un fichier.
    timeZone,
  })

  const link = await prisma.externalLink.findUnique({
    where: { entityType_entityId_provider: cibleDe(row) },
  })

  if (link === null) {
    const cree = await connector.createEvent(draft)
    await prisma.externalLink.create({
      data: {
        ...cibleDe(row),
        userId: row.userId,
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

  // Lu une seule fois par drainage : le fuseau est le même pour toutes les
  // lignes du lot, et le relire par ligne n'ajouterait que des allers-retours.
  const { timeZone } = await getSettings()

  // `nextAttemptAt` porte un **recul après échec**, pas une date d'ouverture :
  // une ligne jamais tentée est due par définition, quelle que soit l'horloge.
  // La mise en file, elle, estampille avec l'horloge système ; comparer les
  // deux rendrait la file inerte dès que l'appelant fournit un autre instant
  // (drainage d'une reprise, test à horloge figée) — et rien ne l'aurait dit,
  // puisqu'une file inerte ne lève rien.
  //
  // `provider` fait partie du filtre, et ce n'est pas une précaution de
  // façade : la file est commune à tous les fournisseurs, ce drainage-ci ne
  // sait parler qu'à l'agenda. Sans ce filtre il prenait aussi les lignes
  // Dolibarr, dont l'`entityId` désigne un CRA : `traiterUpsert` n'y
  // retrouvait aucune saisie, concluait « plus rien à pousser » et supprimait
  // la ligne. Le CRA validé n'arrivait jamais dans Dolibarr, sans qu'aucun
  // écran ne montre le moindre échec.
  const rows = await prisma.syncOutbox.findMany({
    where: {
      userId: args.userId,
      provider: PROVIDER_GOOGLE,
      state: 'PENDING',
      OR: [{ attempts: 0 }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: args.limit ?? TAILLE_LOT,
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
          : await traiterUpsert(connector, row, now, timeZone)

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

export interface DrainReport extends FlushReport {
  /**
   * Lignes encore dues à l'instant du drainage, une fois les passes épuisées.
   *
   * `0` = file vidée. Sans ce chiffre, un compte rendu « 50 traité(s), 50
   * synchronisé(s) » est strictement indiscernable d'une file vidée : le
   * consultant croit avoir terminé et referme l'écran. Les lignes reculées
   * après un échec transitoire n'y figurent pas — elles ne sont pas dues
   * maintenant, et recliquer ne les ferait pas partir plus tôt.
   */
  reste: number
}

/**
 * Lignes de l'agenda dues à cet instant, sans les reculs après échec.
 *
 * Même filtre sur le fournisseur que le drainage : compter ici une ligne que
 * ce drainage-là ne prendra jamais afficherait un reste que recliquer ne fait
 * pas descendre.
 */
function compterDues(userId: string, now: Date): Promise<number> {
  return prisma.syncOutbox.count({
    where: {
      userId,
      provider: PROVIDER_GOOGLE,
      state: 'PENDING',
      OR: [{ attempts: 0 }, { nextAttemptAt: { lte: now } }],
    },
  })
}

/**
 * Draine la file d'un compte **jusqu'au bout**, en enchaînant les passes.
 *
 * C'est le drainage que déclenche le bouton « Synchroniser maintenant », seul
 * moyen d'écoulement de l'installation autoportante : s'arrêter au lot de
 * `limit` lignes y laisserait l'agenda incomplet sans que rien ne le dise.
 *
 * Le connecteur est résolu **une fois** puis réutilisé par toutes les passes —
 * le résoudre à chaque passe rafraîchirait vingt fois le même jeton. L'appelant
 * qui en tient déjà un le passe (`flushAllSyncOutboxes`, les tests).
 */
export async function drainSyncOutbox(args: {
  userId: string
  limit?: number
  now?: Date
  connector?: CalendarConnector | null
  fetchFn?: FetchLike
  /** borne de sécurité, injectée par les tests */
  maxPasses?: number
}): Promise<DrainReport> {
  const now = args.now ?? new Date()
  const limit = args.limit ?? TAILLE_LOT
  const maxPasses = args.maxPasses ?? MAX_PASSES

  const connector =
    args.connector !== undefined
      ? args.connector
      : await resolveConnector(args.userId, {
          ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
          now,
        })

  const cumul: DrainReport = {
    nonConnecte: connector === null,
    traitees: 0,
    reussies: 0,
    conflits: 0,
    echecs: 0,
    reste: 0,
  }

  if (connector !== null) {
    for (let passe = 0; passe < maxPasses; passe++) {
      const r = await flushSyncOutbox({ userId: args.userId, limit, now, connector })
      cumul.traitees += r.traitees
      cumul.reussies += r.reussies
      cumul.conflits += r.conflits
      cumul.echecs += r.echecs
      // Une passe non pleine a vu le fond de la file : la suivante ne
      // trouverait que des lignes reculées après échec, pas encore dues.
      if (r.traitees < limit) break
    }
  }

  cumul.reste = await compterDues(args.userId, now)
  return cumul
}

/**
 * Draine la file de chaque compte connecté. C'est ce que l'endpoint interne
 * appelle : il n'a pas de session, donc pas d'utilisateur courant.
 */
export async function flushAllSyncOutboxes(
  limit = TAILLE_LOT,
  /** injectées par les tests ; la production n'en passe aucune */
  deps: { now?: Date; fetchFn?: FetchLike } = {},
): Promise<{ comptes: number; traitees: number }> {
  const now = deps.now ?? new Date()
  const comptes = await prisma.providerCredential.findMany({
    // La portée fait partie du filtre : la table accueille aussi des clés
    // d'instance, dont le `userId` vide ne draine la file de personne.
    where: { ownerScope: OWNER_SCOPE_USER, provider: PROVIDER_GOOGLE, calendarId: { not: '' } },
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

    const r = await drainSyncOutbox({ userId: compte.userId, limit, now, connector })
    traitees += r.traitees
  }

  return { comptes: comptes.length, traitees }
}
