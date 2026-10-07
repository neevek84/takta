import { prisma } from '@/db/client'
import { canTransition, InvalidTransitionError } from '@/core/cra/state-machine'
import { libelleMois } from '@/core/cra/document'
import { gabaritAnnulationClient } from '@/core/notify/signature'
import type { SignatureConnector } from '@/core/signature/connector'
import type { CraStatus } from '@/core/types'
import { actorOf, appendAudit } from '@/services/audit'
import { transitionCra } from '@/services/cra'
import type { Mailer } from '@/services/notify'
import { envoyerCourriel } from './courriels'
import { cloreEnvoiCourant } from './envois'
import { revoquerLiensDuCra } from './lien-client'
import { getSignatureConnector } from './registry'

const MESSAGES = {
  TRANSITION_IMPOSSIBLE: 'Seul un CRA envoyé peut être retiré.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas pu retirer le document. Le CRA reste envoyé : le client peut encore le signer.',
} as const

/**
 * Retire un CRA envoyé, avant la réponse du client.
 *
 * **L'enveloppe est annulée chez le prestataire d'abord**, et si ça échoue
 * rien ne bouge : un CRA rouvert chez nous mais encore signable chez le
 * prestataire validerait un mois en cours de modification.
 */
export async function annulerEnvoi(
  userId: string,
  craId: string,
  options: { connector?: SignatureConnector | null; mailer?: Mailer | null } = {},
): Promise<{ ok: true } | { ok: false; raison: keyof typeof MESSAGES; message: string }> {
  const echec = (raison: keyof typeof MESSAGES) => ({ ok: false as const, raison, message: MESSAGES[raison] })

  const cra = await prisma.cra.findFirst({
    where: { id: craId, userId },
    include: { mission: { include: { client: true } }, signatureRequest: true },
  })
  if (cra === null || !canTransition(cra.status as CraStatus, 'ANNULER_ENVOI')) return echec('TRANSITION_IMPOSSIBLE')

  const demande = cra.signatureRequest
  // Déjà annulée (reprise après un échec de la transition) : l'enveloppe est
  // retirée et les liens révoqués, il ne reste que la transition.
  const dejaAnnulee = demande !== null && demande.status === 'ANNULE'
  if (demande !== null && !dejaAnnulee && demande.externalId !== '') {
    const connector = options.connector !== undefined ? options.connector : await getSignatureConnector()
    if (connector === null) return echec('CONNECTEUR_EN_ECHEC')
    try {
      await connector.annuler(demande.externalId)
    } catch {
      return echec('CONNECTEUR_EN_ECHEC')
    }
  }

  const maintenant = new Date()
  if (demande !== null && !dejaAnnulee) {
    // Dans cet ordre : l'envoi clos doit recopier l'état ANNULE. Le passage à
    // ANNULE est conditionnel : de deux appels simultanés, un seul le réussit.
    const gagne = await prisma.$transaction(async (tx) => {
      const { count } = await tx.signatureRequest.updateMany({
        where: { craId, status: { not: 'ANNULE' } },
        data: { status: 'ANNULE', completedAt: maintenant },
      })
      if (count === 0) return false
      await cloreEnvoiCourant(tx, craId, maintenant)
      await revoquerLiensDuCra(tx, craId, maintenant)
      return true
    })
    if (!gagne) return echec('TRANSITION_IMPOSSIBLE')
  }

  try {
    await transitionCra(userId, craId, 'ANNULER_ENVOI')
  } catch (e) {
    // Un double clic : l'autre appel a déjà rouvert le CRA.
    if (e instanceof InvalidTransitionError) return echec('TRANSITION_IMPOSSIBLE')
    throw e
  }
  await appendAudit({
    ...(await actorOf(userId)),
    action: 'signature.annulee',
    entityType: 'Cra',
    entityId: craId,
    payload: { numero: demande?.numero ?? 0 },
  })

  if (demande !== null) {
    await envoyerCourriel({
      craId,
      raison: 'ANNULATION',
      to: demande.signataireEmail,
      gabarit: gabaritAnnulationClient({
        clientNom: cra.mission.client.name,
        missionLabel: cra.mission.label,
        moisLibelle: libelleMois(cra.month.toISOString().slice(0, 7)),
        signataireNom: demande.signataireNom,
      }),
      mailer: options.mailer ?? null,
    })
  }

  return { ok: true }
}
