import { prisma } from '@/db/client'
import { isLocked } from '@/core/cra/state-machine'
import type { ConflictKind, ConflictResolution } from '@/core/sync/policy'
import {
  ENTITY_TIME_ENTRY,
  ENTITY_TIME_ENTRY_SUITE,
  ENTITY_TRAJET,
  PROVIDER_GOOGLE,
} from '@/core/sync/policy'
import type { CraStatus, TimeEntryKind } from '@/core/types'
import { saveEntry, toIsoDate } from '@/services/time-entries'
import { enqueueSync } from './outbox'

export interface OpenConflict {
  id: string
  entityId: string
  kind: ConflictKind
  detectedAt: Date
  /** ce que la saisie dit, pour que l'écran soit lisible sans requête de plus */
  libelle: string
  /** ce que Google porte ; `null` quand l'instantané est illisible */
  remote: { summary: string; startLocal: string; endLocal: string } | null
}

export type ResolveResult =
  | { ok: true; resolution: ConflictResolution }
  | {
      ok: false
      reason:
        | 'INTROUVABLE'
        | 'VERROUILLE'
        | 'CAPACITE'
        | 'NON_AFFECTE'
        | 'SAISIE_ABSENTE'
        | 'INSTANTANE_ILLISIBLE'
        | 'JOUR_OCCUPE'
        | 'CHEVAUCHEMENT'
        | 'SEGMENT'
      message: string
    }

interface Snapshot {
  etag?: string
  summary?: string
  startLocal?: string
  endLocal?: string
  externalId?: string
}

function lireSnapshot(json: string): Snapshot | null {
  try {
    const brut: unknown = JSON.parse(json)
    return brut !== null && typeof brut === 'object' ? (brut as Snapshot) : null
  } catch {
    return null
  }
}

/** Un refus de `saveEntry` traduit en motif affichable, tel quel. */
function refus(
  reason: 'CAPACITE' | 'VERROUILLE' | 'NON_AFFECTE' | 'CHEVAUCHEMENT',
): ResolveResult {
  const messages: Record<typeof reason, string> = {
    VERROUILLE:
      "Le CRA de ce mois est validé : la version de l'agenda ne peut pas être acceptée. Rouvrez le CRA, ou rétablissez l'événement.",
    CAPACITE:
      'Accepter cette version dépasserait la capacité de la journée. Le conflit reste ouvert.',
    NON_AFFECTE: "Vous n'êtes plus affecté à cette ligne de prestation.",
    // Une autre saisie de cette prestation commence déjà à cette heure-là :
    // accepter la version de l'agenda superposerait deux blocs.
    CHEVAUCHEMENT:
      'Une autre saisie de cette prestation commence déjà à cette heure-là. Le conflit reste ouvert.',
  }
  return { ok: false, reason, message: messages[reason] }
}

export async function listOpenConflicts(userId: string): Promise<OpenConflict[]> {
  const conflits = await prisma.syncConflict.findMany({
    where: { userId, resolvedAt: null },
    orderBy: { detectedAt: 'desc' },
  })
  if (conflits.length === 0) return []

  const entries = await prisma.timeEntry.findMany({
    where: { userId, id: { in: conflits.map((c) => c.entityId) } },
    include: { line: { include: { mission: { include: { client: true } } } } },
  })
  const parId = new Map(entries.map((e) => [e.id, e]))

  return conflits.map((c) => {
    const entry = parId.get(c.entityId)
    const snapshot = lireSnapshot(c.remoteSnapshotJson)

    return {
      id: c.id,
      entityId: c.entityId,
      kind: c.kind as ConflictKind,
      detectedAt: c.detectedAt,
      libelle:
        entry === undefined
          ? 'Saisie supprimée'
          : `${toIsoDate(entry.date)} · ${entry.line.mission.client.name} · ${entry.line.mission.label} · ${entry.line.label}` +
            // Deux blocs pour une même saisie : l'écran doit dire lequel a bougé.
            (c.entityType === ENTITY_TIME_ENTRY_SUITE ? ' · après la pause' : ''),
      remote:
        snapshot === null
          ? null
          : {
              summary: snapshot.summary ?? '',
              startLocal: snapshot.startLocal ?? '',
              endLocal: snapshot.endLocal ?? '',
            },
    }
  })
}

/** Durée en minutes entre deux heures locales naïves. */
function minutesEntre(startLocal: string, endLocal: string): number {
  const debut = Date.parse(`${startLocal}Z`)
  const fin = Date.parse(`${endLocal}Z`)
  if (Number.isNaN(debut) || Number.isNaN(fin)) return NaN
  return Math.round((fin - debut) / 60_000)
}

/**
 * Le mois de cette saisie est-il verrouillé ?
 *
 * Lecture seule, et **jamais** une seconde règle : le verrou reste jugé par
 * `isLocked`, la fonction que `saveEntry` interroge sur le même couple
 * (mission, mois). Rien ici ne peut donc autoriser une écriture que
 * `saveEntry` refuserait — c'est l'inverse : on refuse **avant** d'écrire.
 *
 * Sans ce coup d'œil préalable, l'ordre imposé (écrire la nouvelle position
 * avant d'effacer l'ancienne) laisse un cas résiduel : ancien mois verrouillé,
 * nouveau mois ouvert. La compensation qui défait alors la nouvelle écriture
 * emporte la saisie qui occupait déjà ce jour-là — une donnée en moins, ce que
 * l'arbitrage promet précisément de ne jamais faire.
 */
async function moisVerrouille(userId: string, lineId: string, isoDate: string): Promise<boolean> {
  const line = await prisma.missionLine.findUnique({
    where: { id: lineId },
    select: { missionId: true },
  })
  if (line === null) return false

  const cra = await prisma.cra.findUnique({
    where: {
      missionId_userId_month: {
        missionId: line.missionId,
        userId,
        month: new Date(`${isoDate.slice(0, 7)}-01T00:00:00.000Z`),
      },
    },
    select: { status: true },
  })

  return cra !== null && isLocked(cra.status as CraStatus)
}

export async function resolveConflict(args: {
  userId: string
  conflictId: string
  resolution: ConflictResolution
}): Promise<ResolveResult> {
  const conflit = await prisma.syncConflict.findFirst({
    where: { id: args.conflictId, userId: args.userId, resolvedAt: null },
  })
  if (conflit === null) {
    return {
      ok: false,
      reason: 'INTROUVABLE',
      message: "Cette divergence n'existe plus ou a déjà été arbitrée.",
    }
  }

  const cible = {
    entityType: conflit.entityType,
    entityId: conflit.entityId,
    provider: conflit.provider,
  }
  const kind = conflit.kind as ConflictKind

  if (args.resolution === 'DETACHER') {
    await prisma.$transaction(async (tx) => {
      // Le lien est rompu ; les deux côtés restent, chacun chez soi.
      await tx.externalLink.deleteMany({ where: cible })
      await tx.syncOutbox.deleteMany({ where: cible })
      await tx.syncConflict.update({
        where: { id: conflit.id },
        data: { resolvedAt: new Date(), resolution: 'DETACHER' },
      })
    })
    return { ok: true, resolution: 'DETACHER' }
  }

  if (args.resolution === 'RETABLIR') {
    await prisma.$transaction(async (tx) => {
      if (kind === 'REMOTE_DELETED') {
        // Plus d'événement en face : sans supprimer le lien, le drainage
        // essaierait de mettre à jour un identifiant mort.
        await tx.externalLink.deleteMany({ where: cible })
      } else {
        // On réécrit par-dessus la version distante : l'etag stocké est remis
        // à zéro, sans quoi le drainage redétecterait la même divergence.
        await tx.externalLink.updateMany({ where: cible, data: { etag: '' } })
      }

      // Le second bloc d'une journée coupée n'entre jamais en file : c'est la
      // saisie entière qu'on repousse, et le drainage retrouve ses deux blocs.
      const aRepousser =
        cible.entityType === ENTITY_TIME_ENTRY_SUITE
          ? { ...cible, entityType: ENTITY_TIME_ENTRY }
          : cible
      await enqueueSync(tx, { userId: args.userId, ...aRepousser, operation: 'UPSERT' })
      await tx.syncConflict.update({
        where: { id: conflit.id },
        data: { resolvedAt: new Date(), resolution: 'RETABLIR' },
      })
    })
    return { ok: true, resolution: 'RETABLIR' }
  }

  // Accepter réécrit la saisie d'après l'événement. Le second bloc n'en porte
  // qu'une moitié : il ne dit ni le début de la journée, ni sa pause, et en
  // tirer une durée transformerait un après-midi retouché en journée facturée.
  if (conflit.entityType === ENTITY_TIME_ENTRY_SUITE) {
    return {
      ok: false,
      reason: 'SEGMENT',
      message:
        "Ce bloc est la seconde moitié d'une journée coupée par la pause : il ne dit pas à lui seul ce que vaut la journée. Rétablissez-le ou détachez-le.",
    }
  }

  // --- ACCEPTER -----------------------------------------------------------
  const entry = await prisma.timeEntry.findFirst({
    where: { id: conflit.entityId, userId: args.userId },
  })
  if (entry === null) {
    return {
      ok: false,
      reason: 'SAISIE_ABSENTE',
      message: "La saisie concernée n'existe plus. Détachez la divergence.",
    }
  }

  // Le premier bloc d'une journée coupée n'en dit pas plus que le second : il
  // s'arrête à la pause. En tirer une durée facturerait la matinée seule, et
  // supprimer la journée parce que la matinée a disparu emporterait l'après-
  // midi. Dans les deux cas, l'autre événement resterait orphelin. Refusé
  // avant toute écriture, disparition comprise.
  if (entry.pauseFinMinute > entry.pauseDebutMinute) {
    return {
      ok: false,
      reason: 'SEGMENT',
      message:
        'Cette journée est coupée par la pause : un seul de ses deux blocs ne dit pas ce que vaut la journée. Rétablissez-le ou détachez-le.',
    }
  }

  const ancienneDate = toIsoDate(entry.date)
  const kindSaisie = entry.kind as TimeEntryKind

  if (kind === 'REMOTE_DELETED') {
    // La suppression passe par saveEntry : sur un mois validé, elle est refusée.
    const suppression = await saveEntry({
      userId: args.userId,
      lineId: entry.lineId,
      date: ancienneDate,
      minutes: 0,
      kind: kindSaisie,
      slotId: entry.slotId,
    })
    if (!suppression.ok) return refus(suppression.reason)

    await prisma.$transaction(async (tx) => {
      await tx.externalLink.deleteMany({ where: cible })
      // La suppression a mis un DELETE en file : il est sans objet, l'événement
      // n'existe déjà plus chez Google.
      await tx.syncOutbox.deleteMany({ where: cible })
      await tx.syncConflict.update({
        where: { id: conflit.id },
        data: { resolvedAt: new Date(), resolution: 'ACCEPTER' },
      })
    })
    return { ok: true, resolution: 'ACCEPTER' }
  }

  const snapshot = lireSnapshot(conflit.remoteSnapshotJson)
  const minutes =
    snapshot === null || snapshot.startLocal === undefined || snapshot.endLocal === undefined
      ? NaN
      : minutesEntre(snapshot.startLocal, snapshot.endLocal)

  if (snapshot === null || Number.isNaN(minutes) || minutes <= 0) {
    return {
      ok: false,
      reason: 'INSTANTANE_ILLISIBLE',
      message:
        "L'événement distant n'est pas exploitable (heures manquantes). Rétablissez ou détachez.",
    }
  }

  const nouvelleDate = (snapshot.startLocal as string).slice(0, 10)
  // Le créneau de la saisie est **conservé** : l'instantané distant n'en porte
  // aucun, et le réécrire à la journée transformerait un « matin » en journée
  // entière — y compris pour une divergence purement cosmétique, où rien ne
  // justifie de rendre l'après-midi indisponible. Seul ce que Google dit
  // vraiment (le jour et la durée) est adopté.
  const slotCible = entry.slotId
  const deplacement = nouvelleDate !== ancienneDate

  // Le déplacement suppose de retirer la saisie de sa place actuelle : si ce
  // retrait est déjà voué au refus, on refuse ici, avant toute écriture (voir
  // `moisVerrouille`).
  if (deplacement && (await moisVerrouille(args.userId, entry.lineId, ancienneDate))) {
    return refus('VERROUILLE')
  }

  // `saveEntry` **upserte** sur (ligne, utilisateur, jour, créneau) : écrire la
  // position d'accueil sans regarder ce qui s'y trouve substituerait la durée
  // de l'événement à la saisie qui l'occupait, que la suppression de l'ancienne
  // achèverait de faire disparaître. Un arbitrage ne prend jamais cette
  // décision à la place de l'utilisateur : il la lui rend, motif à l'appui.
  //
  // Fusionner serait tout aussi arbitraire, et repointer le lien buterait de
  // toute façon sur l'unicité (entityType, entityId, provider) : la saisie
  // d'accueil a déjà le sien.
  const occupant = await prisma.timeEntry.findFirst({
    where: {
      userId: args.userId,
      lineId: entry.lineId,
      date: new Date(`${nouvelleDate}T00:00:00.000Z`),
      slotId: slotCible,
      id: { not: entry.id },
    },
    select: { id: true },
  })
  if (occupant !== null) {
    return {
      ok: false,
      reason: 'JOUR_OCCUPE',
      message:
        `Le ${nouvelleDate} porte déjà une saisie sur cette prestation : l'accepter ` +
        "l'écraserait. Déplacez ou supprimez cette saisie, puis réessayez — ou " +
        'rétablissez plutôt la version du CRA.',
    }
  }

  // On écrit la nouvelle position AVANT d'effacer l'ancienne : l'ordre inverse
  // détruirait la saisie si la seconde écriture était refusée.
  const ecriture = await saveEntry({
    userId: args.userId,
    lineId: entry.lineId,
    date: nouvelleDate,
    minutes,
    kind: kindSaisie,
    slotId: slotCible,
  })
  if (!ecriture.ok) return refus(ecriture.reason)

  if (deplacement) {
    const suppression = await saveEntry({
      userId: args.userId,
      lineId: entry.lineId,
      date: ancienneDate,
      minutes: 0,
      kind: kindSaisie,
      slotId: entry.slotId,
    })
    if (!suppression.ok) {
      // Filet de sécurité : le verrou a été posé entre le contrôle ci-dessus
      // et cette écriture. On défait la nouvelle écriture plutôt que de laisser
      // la journée comptée deux fois.
      await saveEntry({
        userId: args.userId,
        lineId: entry.lineId,
        date: nouvelleDate,
        minutes: 0,
        kind: kindSaisie,
        slotId: slotCible,
      })
      return refus(suppression.reason)
    }
  }

  const deplacee = await prisma.timeEntry.findFirstOrThrow({
    where: {
      userId: args.userId,
      lineId: entry.lineId,
      date: new Date(`${nouvelleDate}T00:00:00.000Z`),
      slotId: slotCible,
    },
  })

  // Déplacée, la saisie renaît sous un identifiant neuf, que `saveEntry` a créé
  // avec le lieu de la mission et des trajets à calculer. C'est pourtant la
  // même saisie : elle garde son lieu, et des trajets déjà posés ne se
  // reposent pas au nouveau jour — ni ceux qu'une saisie à distance n'aurait
  // jamais dû avoir. Une saisie neuve n'a encore rien pu poser : tout trajet
  // non posé à son nom vient de cet arbitrage.
  const deplaceeAilleurs = deplacee.id !== entry.id
  const trajetsEnTrop = deplaceeAilleurs && (entry.lieu !== 'SITE' || entry.trajetsCalcules)

  await prisma.$transaction(async (tx) => {
    if (trajetsEnTrop) {
      const enTrop = await tx.trajet.findMany({
        where: { userId: args.userId, entryId: deplacee.id, poseAt: null },
        select: { id: true },
      })
      const ids = enTrop.map((t) => t.id)
      await tx.syncOutbox.deleteMany({
        where: { entityType: ENTITY_TRAJET, provider: PROVIDER_GOOGLE, entityId: { in: ids } },
      })
      await tx.trajet.deleteMany({ where: { id: { in: ids } } })
    }
    if (deplaceeAilleurs) {
      await tx.timeEntry.update({
        where: { id: deplacee.id },
        data: {
          lieu: entry.lieu,
          // Trajets retirés : le drapeau redevient celui de la saisie
          // d'origine, sans quoi il dirait calculé ce qui ne l'a pas été.
          trajetsCalcules: trajetsEnTrop
            ? entry.trajetsCalcules
            : entry.trajetsCalcules || deplacee.trajetsCalcules,
        },
      })
    }

    // La saisie a suivi l'événement : le lien le suit aussi, avec l'etag
    // distant. Sans lui, le prochain drainage rouvrirait le même conflit.
    await tx.externalLink.updateMany({
      where: cible,
      data: {
        entityId: deplacee.id,
        etag: snapshot.etag ?? '',
        syncState: 'SYNCED',
        syncedAt: new Date(),
      },
    })
    // Les deux `saveEntry` ci-dessus ont mis les saisies en file : accepter la
    // version agenda, c'est justement renoncer à repousser la sienne.
    await tx.syncOutbox.deleteMany({
      where: {
        entityType: conflit.entityType,
        provider: conflit.provider,
        entityId: { in: [conflit.entityId, deplacee.id] },
      },
    })
    await tx.syncConflict.update({
      where: { id: conflit.id },
      data: { resolvedAt: new Date(), resolution: 'ACCEPTER' },
    })
  })

  return { ok: true, resolution: 'ACCEPTER' }
}
