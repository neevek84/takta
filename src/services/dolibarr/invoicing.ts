import { prisma } from '@/db/client'
import { isLocked } from '@/core/cra/state-machine'
import { buildInvoiceDraft, type InvoiceDraft } from '@/core/dolibarr/invoice'
import type { PushableEntry } from '@/core/dolibarr/timespent'
import type { CraStatus, TimeEntryKind } from '@/core/types'
import { getInstanceCredential } from '@/services/credentials'
import {
  DOLIBARR,
  DolibarrRequestError,
  DolibarrUnavailableError,
  type DolibarrApi,
} from './api'

/**
 * Type d'entité porté par `ExternalLink` pour la facture d'un CRA.
 *
 * Comme `CraTimeSpent` pour les temps poussés, cette table porte **toute**
 * l'idempotence de la demande : `createDraftInvoice` n'en a aucune côté
 * Dolibarr, et deux appels produisent deux brouillons chez le client.
 */
const LIEN_FACTURE = 'CraInvoice'

/** Sépare l'identifiant de la facture de sa référence. Aucun des deux n'en contient. */
const SEPARATEUR = '|'

interface Contexte {
  craId: string
  draft: InvoiceDraft
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Rassemble ce qu'il faut pour proposer une facture, ou `null` si la
 * proposition n'a pas lieu d'être.
 *
 * `null` couvre trois cas volontairement indistincts pour l'aperçu : CRA non
 * validé (ou d'un autre), client sans tiers Dolibarr, ou aucun temps réalisé.
 * L'écran n'affiche alors simplement rien ; `requestCraInvoice` les distingue,
 * lui, parce qu'un refus doit s'expliquer.
 */
async function contexte(userId: string, craId: string): Promise<Contexte | null> {
  // Scopé sur `userId` comme toute lecture de service : un compte qui vise le
  // CRA d'un autre ne trouve rien, donc ne propose rien.
  const cra = await prisma.cra.findFirst({
    where: { id: craId, userId },
    select: {
      id: true,
      month: true,
      status: true,
      missionId: true,
      mission: { select: { clientId: true } },
    },
  })
  if (cra === null || !isLocked(cra.status as CraStatus)) return null

  // Le tiers est celui du **client de la mission du CRA**, jamais celui du
  // projet Dolibarr rattaché : c'est ce qui fait que la facture ne peut pas
  // partir au mauvais client. Le garde-fou du rattachement (`attachMission`)
  // refuse déjà d'associer un projet du tiers A à une mission du client B ;
  // lire le tiers ici, du côté client, en bénéficie au lieu de le contourner.
  const lienTiers = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: 'Client',
        entityId: cra.mission.clientId,
        provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })
  if (lienTiers === null) return null

  const debut = new Date(Date.UTC(cra.month.getUTCFullYear(), cra.month.getUTCMonth(), 1))
  const fin = new Date(Date.UTC(cra.month.getUTCFullYear(), cra.month.getUTCMonth() + 1, 1))

  // Le mois est une borne de correction : sans lui, la facture porterait tout
  // l'historique de la mission.
  //
  // La mission est bornée **deux fois** : ici sur les saisies, et plus bas sur
  // les prestations que `buildInvoiceDraft` accepte de facturer. Chacune suffit
  // — une saisie d'une autre mission n'atteint pas la liste des lignes, et une
  // prestation d'une autre mission ne trouve aucune saisie. Aucune n'est
  // retirée pour autant : c'est exactement l'erreur « temps du tiers A facturés
  // au client B » qu'elles ferment, et une redondance vaut mieux qu'un filtre
  // unique qu'un jour quelqu'un jugera superflu.
  const rows = await prisma.timeEntry.findMany({
    where: {
      userId,
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
    },
  })

  const lignes = await prisma.missionLine.findMany({
    where: { missionId: cra.missionId },
    select: { id: true, label: true, tjmCents: true },
    orderBy: { position: 'asc' },
  })

  const entries: PushableEntry[] = rows.map((r) => ({
    id: r.id,
    lineId: r.lineId,
    date: toIsoDate(r.date),
    slotId: r.slotId,
    minutes: r.minutes,
    kind: r.kind as TimeEntryKind,
    // Le facteur figé à l'écriture, jamais le réglage courant : un CRA validé
    // ne change pas de quantité parce que le réglage a bougé depuis.
    minutesParJour: r.minutesParJour,
    comment: r.comment,
  }))

  // Le tri « réalisé seulement » et le groupement par facteur ne sont PAS
  // refaits ici : `buildInvoiceDraft` les porte, et les dupliquer laisserait
  // les deux règles diverger.
  const draft = buildInvoiceDraft({
    socid: Number(lienTiers.externalId),
    month: cra.month.toISOString().slice(0, 7),
    entries,
    lines: lignes,
  })

  return { craId: cra.id, draft }
}

/**
 * Ce que l'application proposerait de demander à Dolibarr, ou `null` quand
 * elle n'a rien à proposer. Aucun appel réseau : c'est une lecture.
 *
 * Sans clé d'API d'instance, la réponse est toujours `null` : le connecteur est
 * additif (spec §1), et une application sans Dolibarr ne doit rien proposer du
 * tout. La garde vit ici et non dans la page — `deconnecterDolibarr` laisse les
 * `ExternalLink` en place exprès, donc les rattachements survivent à la
 * déconnexion et un écran qui se fierait à eux proposerait un bouton dont
 * l'action ne peut plus rien faire.
 */
export async function previewCraInvoice(args: {
  userId: string
  craId: string
}): Promise<InvoiceDraft | null> {
  if ((await getInstanceCredential(DOLIBARR)) === null) return null

  const ctx = await contexte(args.userId, args.craId)
  if (ctx === null || ctx.draft.lines.length === 0) return null
  return ctx.draft
}

export type RequestInvoiceResult =
  | { ok: true; dolibarrInvoiceId: number; ref: string; deja: boolean }
  | {
      ok: false
      reason: 'NON_VALIDE' | 'SANS_TIERS' | 'SANS_LIGNE' | 'REFUSEE' | 'INDISPONIBLE'
      message: string
    }

/**
 * Demande à Dolibarr de créer la facture. Une proposition acceptée, jamais un
 * automatisme (spec §8 bis).
 *
 * L'application transmet des données : elle ne numérote rien, ne calcule
 * aucune TVA, n'émet ni n'archive aucun document. La facture est créée **au
 * brouillon** — un brouillon se corrige, une facture validée est numérotée et
 * immuable.
 *
 * Ne lève jamais : elle rend un verdict, tonalité comprise. Cette demande est
 * une proposition faite après coup, sur un CRA déjà validé et des temps déjà
 * mis en file — la décliner, ou échouer à l'honorer, ne défait rien.
 */
export async function requestCraInvoice(args: {
  userId: string
  craId: string
  api: DolibarrApi
}): Promise<RequestInvoiceResult> {
  // Le contrôle de propriété passe **avant** la recherche d'une facture déjà
  // demandée : `ExternalLink` n'est pas scopé par utilisateur, interroger le
  // lien en premier révélerait l'identifiant de la facture d'un CRA qui
  // n'appartient pas à l'appelant.
  const cra = await prisma.cra.findFirst({
    where: { id: args.craId, userId: args.userId },
    select: { status: true },
  })
  if (cra === null || !isLocked(cra.status as CraStatus)) {
    return {
      ok: false,
      reason: 'NON_VALIDE',
      message: 'La facture ne se demande qu’une fois le CRA validé.',
    }
  }

  const dejaFaite = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: LIEN_FACTURE,
        entityId: args.craId,
        provider: DOLIBARR,
      },
    },
    select: { externalId: true },
  })
  if (dejaFaite !== null) {
    const [id, ref] = dejaFaite.externalId.split(SEPARATEUR) as [string, string | undefined]
    return { ok: true, dolibarrInvoiceId: Number(id), ref: ref ?? '', deja: true }
  }

  const ctx = await contexte(args.userId, args.craId)
  if (ctx === null) {
    return {
      ok: false,
      reason: 'SANS_TIERS',
      message:
        'Le client de cette mission n’est rattaché à aucun tiers Dolibarr. ' +
        'Rattachez-le dans Administration · Dolibarr.',
    }
  }
  if (ctx.draft.lines.length === 0) {
    return {
      ok: false,
      reason: 'SANS_LIGNE',
      message: 'Ce mois ne porte aucun temps réalisé : il n’y a rien à facturer.',
    }
  }

  const suite =
    ' Le CRA reste validé et les temps restent poussés ; la facture peut se créer ' +
    'à la main dans Dolibarr.'

  let facture: { id: number; ref: string }
  try {
    facture = await args.api.createDraftInvoice({
      socid: ctx.draft.socid,
      lines: ctx.draft.lines.map((l) => ({
        label: l.label,
        qteCentiemes: l.qteCentiemes,
        subpriceCents: l.tjmCents,
      })),
    })
  } catch (err) {
    // Un refus n'est pas une panne, et l'annoncer comme telle ferait recliquer
    // indéfiniment sur un bouton qui ne marchera plus : un tiers effacé dans
    // Dolibarr ne réapparaît pas parce qu'on réessaie.
    if (err instanceof DolibarrRequestError) {
      return {
        ok: false,
        reason: 'REFUSEE',
        message: `Dolibarr a refusé la demande : ${err.message}${suite}`,
      }
    }
    // Panne, ou défaut qu'on ne sait pas qualifier : dans les deux cas rien
    // n'a été créé, et réessayer plus tard a un sens.
    const detail = err instanceof DolibarrUnavailableError ? err.message : String(err)
    return {
      ok: false,
      reason: 'INDISPONIBLE',
      message: `Dolibarr est indisponible : ${detail}${suite}`,
    }
  }

  // Écrite immédiatement après l'appel qui l'a créée, et jamais avant : une
  // correspondance posée d'avance désignerait une facture qui n'existe pas, et
  // la demande suivante rendrait « déjà faite » sur du vide.
  await prisma.externalLink.create({
    data: {
      userId: args.userId,
      entityType: LIEN_FACTURE,
      entityId: args.craId,
      provider: DOLIBARR,
      externalId: `${facture.id}${SEPARATEUR}${facture.ref}`,
      syncedAt: new Date(),
      syncState: 'SYNCED',
    },
  })

  return { ok: true, dolibarrInvoiceId: facture.id, ref: facture.ref, deja: false }
}
