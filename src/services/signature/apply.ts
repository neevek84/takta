import { prisma } from '@/db/client'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import type { SignatureConnector, SignatureStatus } from '@/core/signature/connector'
import type { CraStatus } from '@/core/types'
import type { AuditAction } from '@/core/audit/events'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { transitionCra } from '@/services/cra'

export type SignatureEffet = 'VALIDE' | 'REFUSE' | 'EXPIRE' | 'AUCUN'

const TRANSITION_PAR_STATUT: Partial<Record<SignatureStatus, CraTransition>> = {
  SIGNE: 'VALIDER',
  REFUSE: 'REFUSER',
}

/**
 * Le retour du client, au journal de preuve. Le catalogue promet ces deux noms
 * à l'abonnement (`core/audit/events.ts`) : sans émetteur, un intégrateur qui
 * coche `signature.recue` pour déclencher sa facturation attend indéfiniment.
 *
 * Émis **sous l'acteur système**, et non sous le propriétaire du CRA : ce
 * n'est pas lui qui a signé. `transitionCra`, lui, porte bien son nom sur
 * `cra.valide` — c'est son CRA qui change d'état.
 */
const EVENEMENT_PAR_STATUT: Partial<Record<SignatureStatus, AuditAction>> = {
  SIGNE: 'signature.recue',
  REFUSE: 'signature.refusee',
}

/**
 * Applique à un CRA l'état que le prestataire de signature rapporte.
 *
 * **Un seul applicateur pour deux chemins** : le webhook (tâche 11) et le
 * rafraîchissement à la demande (tâche 12) passent tous les deux par ici. Deux
 * implémentations finiraient par diverger, et c'est le verrou d'un mois qui en
 * dépend.
 *
 * **La transition passe par `transitionCra`, jamais par un `cra.update`
 * direct.** Une signature du client *est* une validation : c'est le moment où
 * le mois est arrêté et où les temps consommés partent en file vers Dolibarr,
 * dans la même transaction. Écrire le statut à la main ici verrouillerait le
 * mois sans rien mettre en file — un CRA validé que plus rien ne pousserait
 * jamais, sans qu'aucun écran ne montre d'échec.
 *
 * L'identification passe par `craId`, résolu en amont depuis `ExternalLink` :
 * un webhook n'a pas de session, il est authentifié par la signature de sa
 * charge utile. Le propriétaire est relu sur la ligne du CRA, puisque c'est
 * lui que `transitionCra` exige — le scope reste donc entier.
 *
 * Idempotent par construction : si la transition n'est pas franchissable
 * depuis l'état courant — parce qu'elle l'a déjà été — l'effet est `AUCUN`.
 */
export async function applySignatureStatus(args: {
  craId: string
  externalId: string
  statut: SignatureStatus
  connector?: SignatureConnector | null
}): Promise<SignatureEffet> {
  const cra = await prisma.cra.findUnique({
    where: { id: args.craId },
    select: { id: true, status: true, userId: true },
  })
  if (cra === null) return 'AUCUN'

  const maintenant = new Date()

  if (args.statut === 'EXPIRE') {
    // L'expiration est un fait du prestataire, pas une décision du client :
    // le CRA reste ENVOYE et remonte dans la liste des CRA en souffrance.
    await marquerDemande(args.craId, { status: 'EXPIRE' })
    return 'EXPIRE'
  }

  const transition = TRANSITION_PAR_STATUT[args.statut]
  if (transition === undefined) return 'AUCUN'

  const statut = cra.status as CraStatus
  if (!canTransition(statut, transition)) return 'AUCUN'

  if (args.statut === 'SIGNE') {
    await archiverSiPossible(args.craId, args.externalId, args.connector ?? null)
  }

  await marquerDemande(args.craId, { status: args.statut, completedAt: maintenant })

  await transitionCra(cra.userId, args.craId, transition)

  // Après la transition, et sous la garde d'idempotence qui précède : un rejeu
  // rend `AUCUN` bien avant d'arriver ici, donc aucune seconde entrée. Un
  // abonné qui facture sur `signature.recue` ne facture pas deux fois le même
  // mois parce que le prestataire a relivré son webhook.
  await appendAudit({
    ...ACTEUR_SYSTEME,
    action: EVENEMENT_PAR_STATUT[args.statut]!,
    entityType: 'Cra',
    entityId: args.craId,
    payload: { statut: args.statut, statutAvant: statut },
  })

  return args.statut === 'SIGNE' ? 'VALIDE' : 'REFUSE'
}

async function marquerDemande(
  craId: string,
  data: { status: string; completedAt?: Date },
): Promise<void> {
  // `updateMany` plutôt que `update` : une transition manuelle a pu faire
  // arriver le CRA ici sans qu'aucune demande n'ait jamais été ouverte.
  await prisma.signatureRequest.updateMany({ where: { craId }, data })
}

/**
 * Archive le PDF signé — **une seule fois, et jamais en écrasant**.
 *
 * Un échec de téléchargement ne bloque rien : la signature a eu lieu, le CRA
 * doit être validé même si l'archive arrive plus tard (par un
 * rafraîchissement à la demande) ou jamais.
 */
async function archiverSiPossible(
  craId: string,
  externalId: string,
  connector: SignatureConnector | null,
): Promise<void> {
  if (connector === null) return

  const demande = await prisma.signatureRequest.findUnique({
    where: { craId },
    select: { signedPdf: true },
  })
  if (demande === null || demande.signedPdf != null) return

  try {
    const octets = await connector.download(externalId)
    await prisma.signatureRequest.update({
      where: { craId },
      data: { signedPdf: Buffer.from(octets) },
    })
  } catch {
    // Volontairement silencieux : l'archivage est un plus, la validation est
    // le fait. Le rafraîchissement à la demande retentera.
  }
}
