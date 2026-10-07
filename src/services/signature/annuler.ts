import { prisma } from '@/db/client'
import { canTransition } from '@/core/cra/state-machine'
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
  if (demande !== null && demande.externalId !== '') {
    const connector = options.connector !== undefined ? options.connector : await getSignatureConnector()
    if (connector === null) return echec('CONNECTEUR_EN_ECHEC')
    try {
      await connector.annuler(demande.externalId)
    } catch {
      return echec('CONNECTEUR_EN_ECHEC')
    }
  }

  const maintenant = new Date()
  if (demande !== null) {
    // Dans cet ordre : l'envoi clos doit recopier l'état ANNULE.
    await prisma.$transaction(async (tx) => {
      await tx.signatureRequest.update({ where: { craId }, data: { status: 'ANNULE', completedAt: maintenant } })
      await cloreEnvoiCourant(tx, craId, maintenant)
      await revoquerLiensDuCra(tx, craId, maintenant)
    })
  }

  await transitionCra(userId, craId, 'ANNULER_ENVOI')
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
