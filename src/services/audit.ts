import { prisma } from '@/db/client'
import { isAuditAction, type AuditAction } from '@/core/audit/events'
import {
  GENESIS_HASH,
  hashAuditEntry,
  verifyAuditChain,
  type AuditEntryContent,
  type ChainVerdict,
} from '@/core/audit/chain'
import { redige } from '@/core/log/redact'
import { secretsDuProcessus } from './log'

export interface Acteur {
  /** '' désigne un traitement de fond */
  actorId: string
  actorLabel: string
}

export const ACTEUR_SYSTEME: Acteur = { actorId: '', actorLabel: 'SYSTEME' }

export interface AuditAppend extends Acteur {
  action: AuditAction
  entityType: string
  entityId: string
  /** résumé de ce qui a changé ; sérialisé en bloc, jamais interrogé finement */
  payload: Record<string, unknown>
  occurredAt?: Date
}

export interface AuditEntry extends Acteur {
  seq: number
  occurredAt: Date
  action: AuditAction
  entityType: string
  entityId: string
  payload: Record<string, unknown>
  prevHash: string
  hash: string
}

type Row = Awaited<ReturnType<typeof prisma.auditEvent.findFirstOrThrow>>

function toEntry(row: Row): AuditEntry {
  return {
    seq: row.seq,
    occurredAt: row.occurredAt,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    action: row.action as AuditAction,
    entityType: row.entityType,
    entityId: row.entityId,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
    prevHash: row.prevHash,
    hash: row.hash,
  }
}

/**
 * Rédaction de la charge utile, **au point d'écriture**.
 *
 * Le journal est conservé indéfiniment, exporté, et poussé vers des URL
 * tierces : un secret qui y entre en ressort partout, et une entrée déjà
 * écrite ne se rattrape pas — la chaîne interdit précisément de la corriger
 * après coup. Rédiger à l'affichage arriverait donc toujours trop tard.
 *
 * La rédaction elle-même est celle de `core/log/redact.ts`, consommée telle
 * quelle : une seconde implémentation divergerait de la première au premier
 * défaut corrigé d'un seul côté.
 *
 * Appliquée aux **valeurs**, jamais aux clés : `estCleSensible` traite
 * `clientId` comme sensible — c'est juste pour un identifiant OAuth, faux
 * pour la clé étrangère d'une mission, et effacer le champ entier viderait le
 * journal de ce qui le rend lisible. Les identifiants du produit sont des
 * `cuid()` en minuscules, que la règle des chaînes opaques (majuscules ET
 * chiffres) laisse passer.
 */
function redigeValeur(valeur: unknown, secrets: readonly string[]): unknown {
  if (typeof valeur === 'string') return redige(valeur, secrets)
  if (Array.isArray(valeur)) return valeur.map((v) => redigeValeur(v, secrets))
  if (typeof valeur === 'object' && valeur !== null) {
    const out: Record<string, unknown> = {}
    for (const [cle, v] of Object.entries(valeur)) out[cle] = redigeValeur(v, secrets)
    return out
  }
  return valeur
}

function redigePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const secrets = secretsDuProcessus()
  return redigeValeur(payload, secrets) as Record<string, unknown>
}

/**
 * File d'attente **de processus**. Deux ajouts simultanés liraient la même
 * tête de chaîne et calculeraient le même `prevHash` : l'un des deux serait
 * rejeté par la contrainte d'unicité et devrait reprendre. La file évite ce
 * gâchis à l'intérieur d'une instance ; les contraintes d'unicité restent la
 * garantie entre instances, et `MAX_REPRISES` absorbe leur collision.
 */
let file: Promise<unknown> = Promise.resolve()

function enFile<T>(travail: () => Promise<T>): Promise<T> {
  const execution = file.then(travail, travail)
  file = execution.then(
    () => undefined,
    () => undefined,
  )
  return execution
}

const MAX_REPRISES = 5

function estConflitUnicite(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
  )
}

/**
 * Ajoute une entrée au journal. **Aucune autre écriture n'existe** : le
 * module n'expose ni modification, ni suppression, et
 * `audit-append-only.test.ts` vérifie qu'aucun autre fichier n'en introduit.
 */
export async function appendAudit(entree: AuditAppend): Promise<AuditEntry> {
  if (!isAuditAction(entree.action)) {
    throw new Error(`L'événement « ${entree.action} » n'existe pas au catalogue.`)
  }

  const payloadJson = JSON.stringify(redigePayload(entree.payload))
  const occurredAt = entree.occurredAt ?? new Date()
  const occurredAtIso = occurredAt.toISOString()

  return enFile(async () => {
    for (let tentative = 1; tentative <= MAX_REPRISES; tentative++) {
      const tete = await prisma.auditEvent.findFirst({
        orderBy: { seq: 'desc' },
        select: { seq: true, hash: true },
      })

      const contenu: AuditEntryContent = {
        seq: (tete?.seq ?? 0) + 1,
        occurredAtIso,
        actorId: entree.actorId,
        actorLabel: entree.actorLabel,
        action: entree.action,
        entityType: entree.entityType,
        entityId: entree.entityId,
        payloadJson,
        prevHash: tete?.hash ?? GENESIS_HASH,
      }

      try {
        const row = await prisma.auditEvent.create({
          data: {
            seq: contenu.seq,
            occurredAt,
            actorId: contenu.actorId,
            actorLabel: contenu.actorLabel,
            action: contenu.action,
            entityType: contenu.entityType,
            entityId: contenu.entityId,
            payloadJson: contenu.payloadJson,
            prevHash: contenu.prevHash,
            hash: hashAuditEntry(contenu),
          },
        })
        return toEntry(row)
      } catch (err) {
        // Une autre instance a écrit entre la lecture de la tête et
        // l'insertion : on relit la tête et on recommence.
        if (!estConflitUnicite(err) || tentative === MAX_REPRISES) throw err
      }
    }

    throw new Error(
      `Journal : impossible d'ajouter une entrée après ${MAX_REPRISES} reprises.`,
    )
  })
}

/**
 * Nomme un acteur pour le journal. Le libellé est figé à l'écriture : le
 * journal doit rester lisible même après la disparition du compte, et
 * l'identifiant sert alors de dernier recours.
 */
export async function actorOf(userId: string): Promise<Acteur> {
  if (userId === '') return { ...ACTEUR_SYSTEME }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  })
  return { actorId: userId, actorLabel: user?.name ?? userId }
}

export async function currentAuditSeq(): Promise<number> {
  const tete = await prisma.auditEvent.findFirst({
    orderBy: { seq: 'desc' },
    select: { seq: true },
  })
  return tete?.seq ?? 0
}

const LIMITE_DEFAUT = 100

/**
 * Le rattrapage : les entrées **strictement postérieures** à `since`, dans
 * l'ordre. Un consommateur mémorise le dernier `seq` traité et reprend là où
 * il s'était arrêté — aucun événement ne se perd, même après une panne de
 * plusieurs jours.
 *
 * **Volontairement non scopée par utilisateur** : elle sert un jeton
 * d'instance, pas une session, dans un produit mono-organisation.
 * `listAuditEvents` est la lecture scopée.
 */
export async function readAuditSince(args: {
  since?: number
  limit?: number
  action?: AuditAction
}): Promise<AuditEntry[]> {
  const rows = await prisma.auditEvent.findMany({
    where: {
      seq: { gt: args.since ?? 0 },
      ...(args.action !== undefined && { action: args.action }),
    },
    orderBy: { seq: 'asc' },
    take: args.limit ?? LIMITE_DEFAUT,
  })
  return rows.map(toEntry)
}

export interface AuditFilter {
  action?: AuditAction
  entityType?: string
  /** borne basse incluse, 'YYYY-MM-DD' */
  du?: string
  /** borne haute incluse, 'YYYY-MM-DD' */
  au?: string
  limit?: number
}

/**
 * L'historique de l'écran de supervision, scopé comme toute lecture de
 * service : les actes de l'utilisateur, plus ceux de `SYSTEME`. Masquer ces
 * derniers viderait l'écran de son contenu le plus utile — ce sont eux qui
 * disent ce que les traitements de fond ont fait.
 */
export async function listAuditEvents(
  userId: string,
  filtre: AuditFilter = {},
): Promise<AuditEntry[]> {
  const rows = await prisma.auditEvent.findMany({
    where: {
      actorId: { in: [userId, ''] },
      ...(filtre.action !== undefined && { action: filtre.action }),
      ...(filtre.entityType !== undefined && { entityType: filtre.entityType }),
      ...((filtre.du !== undefined || filtre.au !== undefined) && {
        occurredAt: {
          ...(filtre.du !== undefined && { gte: new Date(`${filtre.du}T00:00:00.000Z`) }),
          ...(filtre.au !== undefined && { lt: jourSuivant(filtre.au) }),
        },
      }),
    },
    orderBy: { seq: 'desc' },
    take: filtre.limit ?? LIMITE_DEFAUT,
  })
  return rows.map(toEntry)
}

/** Borne haute **incluse** : l'utilisateur qui filtre « au 31 » attend le 31. */
function jourSuivant(isoDate: string): Date {
  const d = new Date(`${isoDate}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d
}

/**
 * Recalcule la chaîne complète et signale la première rupture.
 *
 * Relit tout le journal : à quelques milliers d'entrées par an, le coût est
 * négligeable devant ce qu'on prouve. Le jour où il cesserait de l'être,
 * `verifyAuditChain` accepte déjà un ancrage pour vérifier par fenêtres.
 */
export async function verifyJournalChain(): Promise<ChainVerdict> {
  const rows = await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } })

  return verifyAuditChain(
    rows.map((r) => ({
      seq: r.seq,
      occurredAtIso: r.occurredAt.toISOString(),
      actorId: r.actorId,
      actorLabel: r.actorLabel,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      payloadJson: r.payloadJson,
      prevHash: r.prevHash,
      hash: r.hash,
    })),
  )
}
