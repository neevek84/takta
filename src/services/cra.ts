import { prisma } from '@/db/client'
import { applyTransition, type CraTransition } from '@/core/cra/state-machine'
import { ENTITY_CRA } from '@/core/sync/policy'
import type { CraStatus } from '@/core/types'
import { DOLIBARR } from './dolibarr/api'
import { isDolibarrPushArmed } from './dolibarr/push'
import { enqueueSync } from './sync/outbox'

export interface CraView {
  id: string
  missionId: string
  missionLabel: string
  clientName: string
  /** 'YYYY-MM' */
  month: string
  status: CraStatus
  invoiceNumber: string | null
  invoicedAt: Date | null
  paidAt: Date | null
}

const WITH_MISSION = { mission: { include: { client: true } } } as const

type Row = {
  id: string
  missionId: string
  month: Date
  status: string
  invoiceNumber: string | null
  invoicedAt: Date | null
  paidAt: Date | null
  mission: { label: string; client: { name: string } }
}

function toView(row: Row): CraView {
  return {
    id: row.id,
    missionId: row.missionId,
    missionLabel: row.mission.label,
    clientName: row.mission.client.name,
    month: row.month.toISOString().slice(0, 7),
    status: row.status as CraStatus,
    invoiceNumber: row.invoiceNumber,
    invoicedAt: row.invoicedAt,
    paidAt: row.paidAt,
  }
}

function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`)
}

export async function getOrCreateCra(
  userId: string,
  missionId: string,
  month: string,
): Promise<CraView> {
  const row = await prisma.cra.upsert({
    where: { missionId_userId_month: { missionId, userId, month: monthStart(month) } },
    create: { missionId, userId, month: monthStart(month) },
    update: {},
    include: WITH_MISSION,
  })
  return toView(row)
}

/**
 * Fait passer un CRA d'un état à l'autre — et, quand la transition le valide,
 * inscrit ses temps dans la file de synchronisation.
 *
 * **La validation est le déclencheur, et le seul.** C'est le moment où le mois
 * est arrêté : le CRA est fait, envoyé, validé par le client, et les temps
 * consommés peuvent partir chez Dolibarr. Aucun autre passage n'en met en
 * file — pousser un brouillon enverrait du temps qui n'est pas arrêté, et la
 * réconciliation du push retirerait de Dolibarr les journées que l'utilisateur
 * est justement en train de corriger.
 *
 * **Rien de Dolibarr n'est appelé ici.** La fonction écrit en base et met en
 * file, un point : c'est ce qui garantit qu'une instance éteinte ne peut jamais
 * empêcher de valider un CRA. Le drainage, lui, tourne plus tard et rejouera.
 *
 * **Et la facture ?** Elle n'est pas ici, et elle ne sera jamais calculée ici :
 * Dolibarr facture, pas le CRA. L'application ne demande aucune facture — elle
 * pousse les temps consommés, et le porteur les facture depuis le projet
 * Dolibarr, là où chaque ligne de temps passe de « Facturée : Non » à la
 * référence de sa facture. Les champs `invoiceNumber`, `invoicedAt` et `paidAt`
 * du CRA sont un suivi saisi à la main, pas le produit d'un calcul.
 */
export async function transitionCra(
  userId: string,
  craId: string,
  t: CraTransition,
): Promise<CraView> {
  // Le scope par userId est la garantie qu'on n'agit jamais sur le CRA d'un autre.
  const current = await prisma.cra.findFirstOrThrow({ where: { id: craId, userId } })
  const next = applyTransition(current.status as CraStatus, t)

  // Lu **avant** la transaction : deux lectures, aucun appel réseau, et rien
  // qui ait à tenir le verrou d'écriture.
  const arme = next === 'VALIDE' && (await isDolibarrPushArmed(current.missionId))

  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.cra.update({
      where: { id: craId },
      data: { status: next },
      include: WITH_MISSION,
    })

    // La mise en file est transactionnelle avec le changement d'état, dans les
    // deux sens. Un CRA validé sans ligne de file, c'est un mois verrouillé
    // que plus rien ne poussera jamais : Dolibarr resterait vide, l'écran de
    // synchronisation muet, et personne ne le saurait avant la facture
    // manquante. Une ligne sans validation, à l'inverse, ferait pousser des
    // temps que l'utilisateur peut encore modifier.
    //
    // Le `payload` reste vide, comme pour l'agenda : la cible est un CRA, et
    // un CRA se relit. Le drainage retrouve mission, mois et saisies en base
    // au moment où il pousse — y figer le mois ici ne servirait qu'à porter
    // une copie qui peut devenir fausse.
    if (arme) {
      await enqueueSync(tx, {
        userId,
        entityType: ENTITY_CRA,
        entityId: craId,
        provider: DOLIBARR,
      })
    }

    return updated
  })

  return toView(row)
}

export async function updateInvoiceTracking(
  userId: string,
  craId: string,
  patch: { invoiceNumber?: string | null; invoicedAt?: Date | null; paidAt?: Date | null },
): Promise<CraView> {
  await prisma.cra.findFirstOrThrow({ where: { id: craId, userId } })

  const row = await prisma.cra.update({
    where: { id: craId },
    data: patch,
    include: WITH_MISSION,
  })
  return toView(row)
}

export async function listCras(userId: string, month: string): Promise<CraView[]> {
  const rows = await prisma.cra.findMany({
    where: { userId, month: monthStart(month) },
    include: WITH_MISSION,
    orderBy: { mission: { label: 'asc' } },
  })
  return rows.map(toView)
}
