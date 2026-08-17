import { prisma } from '@/db/client'
import type { SignatureConnector } from '@/core/signature/connector'
import { getSettings } from '@/services/settings'
import { ENTITY_CRA } from './constants'
import { getSignatureConnector } from './registry'

/** Au-delà, on cesse de relancer et le CRA remonte en souffrance. */
export const RELANCES_MAX = 3

export interface ReminderReport {
  relancees: number
  abandonnees: number
  /** demandes échues qu'aucun connecteur ne pouvait relancer */
  sansConnecteur: number
  /** relances tentées et refusées par le prestataire */
  echecs: number
}

const JOUR_EN_MS = 24 * 60 * 60 * 1000

/**
 * Relance les signatures en attente dont le délai est écoulé, puis abandonne
 * au-delà de `RELANCES_MAX`.
 *
 * **Un travail de fond porte sur l'instance** : sans `userId`, il traverse
 * toutes les demandes — c'est ce que fait un ordonnanceur, qui n'a pas de
 * session. Avec `userId`, il se scope, pour le bouton de l'écran CRA.
 *
 * `now` est un paramètre et jamais l'horloge : un travail de fond qui lit
 * l'heure lui-même ne se teste pas.
 *
 * Sans connecteur, la fonction **compte et rend la main**. Elle n'échoue
 * jamais : une instance sans outil de signature doit pouvoir appeler
 * l'ordonnanceur sans que rien ne casse.
 *
 * **Rien n'est consigné au journal de preuve.** Le catalogue
 * (`core/audit/events.ts`) ne porte ni relance ni abandon, et il est un
 * contrat public : y ajouter un nom au passage engagerait des abonnés qu'on ne
 * voit pas depuis ce dépôt. Une relance n'est d'ailleurs pas un acte humain —
 * ce que le journal atteste, c'est ce qu'une personne a décidé.
 */
export async function runSignatureReminders(
  args: { userId?: string; now?: Date; connector?: SignatureConnector | null } = {},
): Promise<ReminderReport> {
  const rapport: ReminderReport = { relancees: 0, abandonnees: 0, sansConnecteur: 0, echecs: 0 }

  const settings = await getSettings()
  if (settings.relanceJours <= 0) return rapport

  const now = args.now ?? new Date()
  const echeance = new Date(now.getTime() - settings.relanceJours * JOUR_EN_MS)

  const demandes = await prisma.signatureRequest.findMany({
    where: {
      status: 'EN_ATTENTE',
      // Une demande abandonnée est sortie du circuit automatique : elle attend
      // une reprise humaine, pas un quatrième courriel.
      abandoned: false,
      completedAt: null,
      // **Le CRA est joint, et son état fait partie du filtre.** Sans lui, un
      // CRA validé — ou refusé — à la main pendant que la signature courait
      // gardait une demande `EN_ATTENTE` intacte : `applySignatureStatus` rend
      // `AUCUN` avant de marquer la demande quand la transition n'est plus
      // franchissable. Le client recevait alors trois « merci de signer » sur
      // un mois déjà arrêté, puis le CRA remontait en « souffrance ».
      cra: {
        status: 'ENVOYE',
        ...(args.userId === undefined ? {} : { userId: args.userId }),
      },
    },
    select: {
      craId: true,
      provider: true,
      relances: true,
      sentAt: true,
      lastRelanceAt: true,
    },
  })

  const echues = demandes.filter((d) => (d.lastRelanceAt ?? d.sentAt) <= echeance)
  if (echues.length === 0) return rapport

  const connector = args.connector !== undefined ? args.connector : await getSignatureConnector()

  for (const demande of echues) {
    if (demande.relances >= RELANCES_MAX) {
      // Le CRA reste ENVOYE : trois relances sans réponse est un problème
      // humain, pas un problème d'état. On le rend visible, on ne l'annule pas.
      await prisma.signatureRequest.update({
        where: { craId: demande.craId },
        data: { abandoned: true },
      })
      rapport.abandonnees += 1
      continue
    }

    if (connector === null) {
      rapport.sansConnecteur += 1
      continue
    }

    const lien = await prisma.externalLink.findUnique({
      where: {
        entityType_entityId_provider: {
          entityType: ENTITY_CRA,
          entityId: demande.craId,
          provider: demande.provider,
        },
      },
      select: { externalId: true },
    })
    if (lien === null) {
      rapport.echecs += 1
      continue
    }

    try {
      await connector.remind(lien.externalId)
    } catch {
      // Un échec ne consomme pas de relance et n'arrête pas le travail : le
      // prochain passage retentera, et les demandes suivantes sont traitées.
      rapport.echecs += 1
      continue
    }

    // Après le `remind`, jamais avant : incrémenter d'abord ferait payer une
    // relance à une panne du prestataire, et trois pannes de suite
    // abandonneraient un CRA que personne n'a jamais relancé.
    await prisma.signatureRequest.update({
      where: { craId: demande.craId },
      data: { relances: { increment: 1 }, lastRelanceAt: now },
    })
    rapport.relancees += 1
  }

  return rapport
}
