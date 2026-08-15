import { prisma } from '@/db/client'
import { applyTransition, type CraTransition } from '@/core/cra/state-machine'
import type { CraStatus } from '@/core/types'

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

export async function transitionCra(
  userId: string,
  craId: string,
  t: CraTransition,
): Promise<CraView> {
  // Le scope par userId est la garantie qu'on n'agit jamais sur le CRA d'un autre.
  const current = await prisma.cra.findFirstOrThrow({ where: { id: craId, userId } })
  const next = applyTransition(current.status as CraStatus, t)

  const row = await prisma.cra.update({
    where: { id: craId },
    data: { status: next },
    include: WITH_MISSION,
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
