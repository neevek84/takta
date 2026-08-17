import { prisma } from '@/db/client'
import type { SignatureConnector, SignatureStatus } from '@/core/signature/connector'
import { applySignatureStatus, type SignatureEffet } from './apply'
import { ENTITY_CRA } from './constants'
import { getSignatureConnector } from './registry'

export type RefreshRaison = 'PAS_DE_DEMANDE' | 'PAS_DE_CONNECTEUR' | 'CONNECTEUR_EN_ECHEC'

export type RefreshResult =
  | { ok: true; statut: SignatureStatus; effet: SignatureEffet }
  | { ok: false; raison: RefreshRaison; message: string }

const MESSAGES: Record<RefreshRaison, string> = {
  PAS_DE_DEMANDE: 'Ce CRA n’a jamais été envoyé pour signature.',
  PAS_DE_CONNECTEUR:
    'Aucun outil de signature n’est configuré. Utilisez les transitions manuelles.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas répondu. Réessayez, ou utilisez les transitions manuelles.',
}

function echec(raison: RefreshRaison): RefreshResult {
  return { ok: false, raison, message: MESSAGES[raison] }
}

/**
 * Interroge le prestataire et applique ce qu'il rapporte.
 *
 * **C'est le rattrapage d'un webhook perdu.** Un circuit qui dépend d'un
 * webhook qui n'arrive jamais est un circuit cassé : ce bouton, plus la
 * transition manuelle toujours disponible, garantissent qu'on avance quoi
 * qu'il arrive.
 *
 * Passe par `applySignatureStatus`, exactement comme le webhook : deux
 * chemins qui appliqueraient le même statut différemment finiraient par
 * diverger, et c'est un verrou de mois qui en dépend.
 */
export async function refreshSignatureStatus(
  userId: string,
  craId: string,
  options: { connector?: SignatureConnector | null } = {},
): Promise<RefreshResult> {
  // Scope par `userId` en premier : on n'interroge jamais le prestataire au
  // sujet du CRA d'un autre, et on ne lui apprend donc pas qu'il existe.
  const cra = await prisma.cra.findFirst({ where: { id: craId, userId }, select: { id: true } })
  if (cra === null) return echec('PAS_DE_DEMANDE')

  const demande = await prisma.signatureRequest.findUnique({
    where: { craId },
    select: { provider: true },
  })
  if (demande === null) return echec('PAS_DE_DEMANDE')

  const lien = await prisma.externalLink.findUnique({
    where: {
      entityType_entityId_provider: {
        entityType: ENTITY_CRA,
        entityId: craId,
        provider: demande.provider,
      },
    },
    select: { externalId: true },
  })
  if (lien === null) return echec('PAS_DE_DEMANDE')

  const connector =
    options.connector !== undefined ? options.connector : await getSignatureConnector()
  if (connector === null) return echec('PAS_DE_CONNECTEUR')

  let statut: SignatureStatus
  try {
    statut = await connector.status(lien.externalId)
  } catch {
    // Injoignable n'est pas « rien à signaler » : rendre EN_ATTENTE ici
    // ferait passer une panne pour une réponse, et l'utilisateur attendrait
    // indéfiniment un document déjà signé.
    return echec('CONNECTEUR_EN_ECHEC')
  }

  const effet = await applySignatureStatus({
    craId,
    externalId: lien.externalId,
    statut,
    connector,
  })

  // Rattrapage de l'archive : la signature a pu être appliquée par un webhook
  // au moment où le téléchargement du document échouait. `applySignatureStatus`
  // n'y touche plus une fois la transition franchie, on repasse donc ici — et
  // jamais par-dessus une archive existante : un document signé se conserve,
  // il ne se recalcule pas.
  if (statut === 'SIGNE') {
    const demandeRelue = await prisma.signatureRequest.findUnique({
      where: { craId },
      select: { signedPdf: true },
    })
    if (demandeRelue !== null && demandeRelue.signedPdf == null) {
      try {
        const octets = await connector.download(lien.externalId)
        await prisma.signatureRequest.update({
          where: { craId },
          data: { signedPdf: Buffer.from(octets), status: 'SIGNE' },
        })
      } catch {
        // L'archive attendra le prochain rafraîchissement. Le CRA, lui, est
        // déjà dans le bon état.
      }
    }
  }

  await prisma.externalLink.updateMany({
    where: { entityType: ENTITY_CRA, entityId: craId, provider: demande.provider },
    data: { syncState: statut, syncedAt: new Date() },
  })

  return { ok: true, statut, effet }
}

export interface RefreshSweepReport {
  /** demandes réellement soumises au prestataire */
  examinees: number
  valides: number
  refusees: number
  expirees: number
  /** le prestataire n'a rien de neuf à dire */
  inchangees: number
  /** interrogations impossibles : le prochain passage retentera */
  echecs: number
}

/**
 * Le balayage que l'ordonnanceur déclenche : **le rattrapage des webhooks
 * perdus, sans qu'aucun humain n'ait à cliquer**.
 *
 * Comme la relance, il porte sur l'instance quand aucun `userId` n'est donné :
 * un réveil externe n'a pas de session, et une demande appartient au compte de
 * son CRA, pas à l'appelant.
 *
 * Ne sélectionne que ce qu'il peut encore faire bouger : demande `EN_ATTENTE`,
 * jamais achevée, et **CRA encore `ENVOYE`**. Un CRA validé ou refusé à la
 * main garde une demande `EN_ATTENTE` intacte — `applySignatureStatus` rend
 * `AUCUN` avant de la marquer quand la transition n'est plus franchissable —
 * et l'interroger n'apprendrait rien à personne tout en faisant un appel
 * réseau par passage, indéfiniment.
 *
 * Chaque demande passe par `refreshSignatureStatus`, jamais par un chemin
 * parallèle : deux applicateurs du même statut finiraient par diverger, et
 * c'est un verrou de mois qui en dépend.
 *
 * Un prestataire injoignable compte un échec et n'arrête pas le balayage : les
 * demandes suivantes n'ont pas à payer la panne de la première.
 */
export async function refreshPendingSignatures(
  args: { userId?: string; connector?: SignatureConnector | null } = {},
): Promise<RefreshSweepReport> {
  const rapport: RefreshSweepReport = {
    examinees: 0,
    valides: 0,
    refusees: 0,
    expirees: 0,
    inchangees: 0,
    echecs: 0,
  }

  const connector =
    args.connector !== undefined ? args.connector : await getSignatureConnector()
  // Sans outil de signature, il n'y a rien à rafraîchir — et ce n'est pas une
  // panne : c'est le mode nominal d'une instance qui n'en a pas.
  if (connector === null) return rapport

  const demandes = await prisma.signatureRequest.findMany({
    where: {
      status: 'EN_ATTENTE',
      completedAt: null,
      cra: {
        status: 'ENVOYE',
        ...(args.userId === undefined ? {} : { userId: args.userId }),
      },
    },
    select: { craId: true, cra: { select: { userId: true } } },
  })

  for (const demande of demandes) {
    rapport.examinees += 1

    // Le propriétaire vient de la ligne du CRA, jamais de l'appelant : le
    // scope de `refreshSignatureStatus` reste entier même sous un réveil qui
    // n'a pas de session.
    const r = await refreshSignatureStatus(demande.cra.userId, demande.craId, { connector })

    if (!r.ok) {
      rapport.echecs += 1
      continue
    }

    if (r.effet === 'VALIDE') rapport.valides += 1
    else if (r.effet === 'REFUSE') rapport.refusees += 1
    else if (r.effet === 'EXPIRE') rapport.expirees += 1
    else rapport.inchangees += 1
  }

  return rapport
}
