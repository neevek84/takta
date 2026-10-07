import { prisma } from '@/db/client'
import type { SignatureConnector } from '@/core/signature/connector'
import { libelleMois } from '@/core/cra/document'
import { gabaritRelanceClient } from '@/core/notify/signature'
import type { Mailer } from '@/services/notify'
import { getSettings } from '@/services/settings'
import { ENTITY_CRA } from './constants'
import { envoyerCourriel } from './courriels'
import { creerLienClient } from './lien-client'
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
 * Relancer n'est pas un acte humain : rien n'est consigné **au nom du
 * consultant** ; le courriel, lui, est journalisé par `envoyerCourriel`
 * (`signature.courriel.*`), sans contenu.
 *
 * Deux voies. Un envoi du lot 3b (`origine` renseignée) est relancé **par
 * l'outil** : un lien neuf part par courriel, les liens déjà reçus restent
 * valables. Un envoi hérité est relancé **par le prestataire**, qui réécrit
 * lui-même quand on renouvelle son lien.
 */
export async function runSignatureReminders(
  args: {
    userId?: string
    now?: Date
    connector?: SignatureConnector | null
    mailer?: Mailer | null
  } = {},
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
      numero: true,
      origine: true,
      externalId: true,
      signataireNom: true,
      signataireEmail: true,
      cra: {
        select: {
          month: true,
          mission: { select: { label: true, client: { select: { name: true } } } },
        },
      },
      relances: true,
      sentAt: true,
      lastRelanceAt: true,
    },
  })

  const echues = demandes.filter((d) => (d.lastRelanceAt ?? d.sentAt) <= echeance)
  if (echues.length === 0) return rapport

  // Résolu paresseusement, une seule fois : seuls les envois hérités en ont besoin.
  let connector: SignatureConnector | null | undefined = args.connector

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

    let relancee: boolean
    if (demande.origine !== '') {
      // Lot 3b : c'est l'outil qui écrit. Un lien neuf part — le jeton n'est
      // jamais conservé en clair, on ne peut donc pas renvoyer l'ancien — et
      // les liens déjà reçus restent valables.
      const ligne = await prisma.lienClient.findFirst({
        where: { craId: demande.craId, numero: demande.numero, revokedAt: null },
        select: { jetonSignataire: true },
      })
      const jeton = await prisma.$transaction((tx) =>
        creerLienClient(tx, {
          craId: demande.craId,
          numero: demande.numero,
          jetonSignataire: ligne?.jetonSignataire ?? '',
        }),
      )
      const mois = demande.cra.month.toISOString().slice(0, 7)
      const r = await envoyerCourriel({
        craId: demande.craId,
        raison: 'RELANCE',
        to: demande.signataireEmail,
        gabarit: gabaritRelanceClient({
          clientNom: demande.cra.mission.client.name,
          missionLabel: demande.cra.mission.label,
          moisLibelle: libelleMois(mois),
          signataireNom: demande.signataireNom,
          lien: `${demande.origine}/v/${jeton}`,
        }),
        mailer: args.mailer ?? null,
      })
      relancee = r.envoye
    } else {
      // Envoi hérité : distribué par courriel du prestataire, c'est lui qui
      // relance quand on renouvelle son lien.
      if (connector === undefined) connector = await getSignatureConnector()
      if (connector === null) {
        rapport.sansConnecteur += 1
        continue
      }
      const externalId =
        demande.externalId !== ''
          ? demande.externalId
          : await lienExterne(demande.craId, demande.provider)
      if (externalId === null) {
        rapport.echecs += 1
        continue
      }
      try {
        await connector.renouveler(externalId)
        relancee = true
      } catch {
        relancee = false
      }
    }

    if (!relancee) {
      // Un échec ne consomme pas de relance et n'arrête pas le travail : le
      // prochain passage retentera. Trois pannes de suite abandonneraient
      // sinon un CRA que personne n'a jamais relancé.
      rapport.echecs += 1
      continue
    }

    // Après l'envoi, jamais avant : incrémenter d'abord ferait payer une
    // relance à une panne.
    await prisma.signatureRequest.update({
      where: { craId: demande.craId },
      data: { relances: { increment: 1 }, lastRelanceAt: now },
    })
    rapport.relancees += 1
  }

  return rapport
}

async function lienExterne(craId: string, provider: string): Promise<string | null> {
  const lien = await prisma.externalLink.findUnique({
    where: { entityType_entityId_provider: { entityType: ENTITY_CRA, entityId: craId, provider } },
    select: { externalId: true },
  })
  return lien?.externalId ?? null
}
