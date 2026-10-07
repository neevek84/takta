import type { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'

export type EnvoiStatut = 'EN_ATTENTE' | 'SIGNE' | 'REFUSE' | 'EXPIRE' | 'ANNULE'

export interface EnvoiVue {
  numero: number
  status: EnvoiStatut
  sentAt: Date
  completedAt: Date | null
  motifRefus: string
  signataireNom: string
  empreinte: string
  /** l'envoi en cours, celui que porte `SignatureRequest` */
  enCours: boolean
}

/**
 * Recopie l'envoi en cours dans `SignatureEnvoiClos`, **avant** qu'un renvoi
 * ou une annulation ne le remplace.
 *
 * Idempotent par l'unicité `(craId, numero)` : un double appel — une action
 * rejouée, une transaction reprise — n'empile pas deux fois le même envoi.
 * Une ligne close ne change plus jamais ensuite.
 */
export async function cloreEnvoiCourant(
  tx: Prisma.TransactionClient,
  craId: string,
  maintenant: Date,
): Promise<void> {
  const courant = await tx.signatureRequest.findUnique({ where: { craId } })
  if (courant === null) return

  await tx.signatureEnvoiClos.upsert({
    where: { craId_numero: { craId, numero: courant.numero } },
    create: {
      craId,
      numero: courant.numero,
      status: courant.status,
      motifRefus: courant.motifRefus,
      signataireNom: courant.signataireNom,
      signataireEmail: courant.signataireEmail,
      sentAt: courant.sentAt,
      completedAt: courant.completedAt,
      empreinte: courant.empreinte,
      closAt: maintenant,
    },
    update: {},
  })
}

/**
 * L'historique des envois d'un CRA : l'envoi en cours, puis les envois clos,
 * du plus récent au plus ancien. Scopé par `userId` — l'historique d'un autre
 * ne se lit pas en devinant un identifiant.
 */
export async function listerEnvois(userId: string, craId: string): Promise<EnvoiVue[]> {
  const cra = await prisma.cra.findFirst({ where: { id: craId, userId }, select: { id: true } })
  if (cra === null) return []

  const [courant, clos] = await Promise.all([
    prisma.signatureRequest.findUnique({ where: { craId } }),
    prisma.signatureEnvoiClos.findMany({ where: { craId }, orderBy: { numero: 'desc' } }),
  ])

  const vues: EnvoiVue[] = clos.map((c) => ({
    numero: c.numero,
    status: c.status as EnvoiStatut,
    sentAt: c.sentAt,
    completedAt: c.completedAt,
    motifRefus: c.motifRefus,
    signataireNom: c.signataireNom,
    empreinte: c.empreinte,
    enCours: false,
  }))

  if (courant !== null && !vues.some((v) => v.numero === courant.numero)) {
    vues.unshift({
      numero: courant.numero,
      status: courant.status as EnvoiStatut,
      sentAt: courant.sentAt,
      completedAt: courant.completedAt,
      motifRefus: courant.motifRefus,
      signataireNom: courant.signataireNom,
      empreinte: courant.empreinte,
      enCours: true,
    })
  }

  return vues
}
