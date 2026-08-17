import { prisma } from '@/db/client'
import { canTransition } from '@/core/cra/state-machine'
import { libelleMois } from '@/core/cra/document'
import type { SignatureConnector } from '@/core/signature/connector'
import type { CraStatus } from '@/core/types'
import { actorOf, appendAudit } from '@/services/audit'
import { transitionCra } from '@/services/cra'
import { buildCraPdf } from '@/services/cra-pdf'
import { ENTITY_CRA } from './constants'
import { getSignatureConnector } from './registry'

export type SendCraRaison =
  | 'PAS_DE_CONNECTEUR'
  | 'PAS_DE_SIGNATAIRE'
  | 'TRANSITION_IMPOSSIBLE'
  | 'CONNECTEUR_EN_ECHEC'

export type SendCraResult =
  | { ok: true; externalId: string; status: CraStatus }
  | { ok: false; raison: SendCraRaison; message: string }

const MESSAGES: Record<SendCraRaison, string> = {
  PAS_DE_CONNECTEUR:
    'Aucun outil de signature n’est configuré. Le CRA reste téléchargeable et les transitions manuelles restent disponibles.',
  PAS_DE_SIGNATAIRE:
    'Renseignez le signataire de la mission (nom et adresse électronique) avant d’envoyer le CRA.',
  TRANSITION_IMPOSSIBLE: 'Ce CRA ne peut pas être envoyé dans son état actuel.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas accepté le document. Le CRA n’a pas changé d’état.',
}

function echec(raison: SendCraRaison): SendCraResult {
  return { ok: false, raison, message: MESSAGES[raison] }
}

/**
 * Envoie le CRA au signataire de sa mission.
 *
 * **L'ordre des opérations est la garantie du circuit** : le document est
 * composé, confié au connecteur, et le CRA ne passe à `ENVOYE` qu'ensuite.
 * Transitionner d'abord laisserait, au moindre échec, un CRA marqué envoyé
 * que personne n'a reçu — et un mois qu'on ne peut plus rouvrir sans passer
 * par `REFUSER`.
 *
 * Le document confié est **exactement** celui de `buildCraPdf` : le même
 * fichier que l'utilisateur télécharge, sans aucun montant. Le composer
 * autrement ici serait le seul endroit du dépôt où un CRA partant chez le
 * client échapperait aux tests du PDF.
 *
 * `options.connector` sert aux tests et aux appelants qui ont déjà résolu le
 * connecteur ; sans lui, le registre décide — et peut rendre `null`, qui
 * n'est pas une panne mais le mode nominal d'une instance sans outil de
 * signature.
 */
export async function sendCraForSignature(
  userId: string,
  craId: string,
  options: { connector?: SignatureConnector | null } = {},
): Promise<SendCraResult> {
  // Le scope par `userId` est la garantie qu'on n'envoie jamais le CRA d'un
  // autre en devinant un identifiant.
  const cra = await prisma.cra.findFirst({
    where: { id: craId, userId },
    include: { mission: { include: { client: true } } },
  })
  if (cra === null) return echec('TRANSITION_IMPOSSIBLE')

  const statut = cra.status as CraStatus
  if (!canTransition(statut, 'ENVOYER')) return echec('TRANSITION_IMPOSSIBLE')

  const destinataire = {
    nom: cra.mission.signataireNom,
    email: cra.mission.signataireEmail,
  }
  // Les deux, et pas seulement l'adresse : un destinataire à moitié renseigné
  // se ferait refuser par le prestataire, et l'utilisateur lirait « l'outil de
  // signature n'a pas accepté le document » là où c'est sa mission qui est
  // incomplète.
  if (destinataire.email === '' || destinataire.nom === '') return echec('PAS_DE_SIGNATAIRE')

  const connector =
    options.connector !== undefined ? options.connector : await getSignatureConnector()
  if (connector === null) return echec('PAS_DE_CONNECTEUR')

  const { fileName, bytes } = await buildCraPdf(userId, craId)
  const mois = cra.month.toISOString().slice(0, 7)
  const titre = `CRA ${cra.mission.client.name} — ${cra.mission.label} — ${libelleMois(mois)}`

  let externalId: string
  try {
    externalId = await connector.send({ titre, fileName, pdf: bytes, destinataire })
  } catch {
    // L'erreur n'est pas propagée telle quelle : elle peut porter ce que le
    // prestataire a renvoyé, et ce message finit sous les yeux de
    // l'utilisateur. L'état du CRA, lui, n'a pas bougé.
    return echec('CONNECTEUR_EN_ECHEC')
  }

  const maintenant = new Date()

  // Une seule demande par CRA : renvoyer remplace, et remet à zéro tout ce
  // qui appartenait à l'envoi précédent — relances, abandon, archive.
  await prisma.signatureRequest.upsert({
    where: { craId },
    create: {
      craId,
      provider: connector.provider,
      status: 'EN_ATTENTE',
      signataireNom: destinataire.nom,
      signataireEmail: destinataire.email,
      sentAt: maintenant,
    },
    update: {
      provider: connector.provider,
      status: 'EN_ATTENTE',
      signataireNom: destinataire.nom,
      signataireEmail: destinataire.email,
      sentAt: maintenant,
      relances: 0,
      lastRelanceAt: null,
      completedAt: null,
      abandoned: false,
      signedPdf: null,
    },
  })

  await prisma.externalLink.upsert({
    where: {
      entityType_entityId_provider: {
        entityType: ENTITY_CRA,
        entityId: craId,
        provider: connector.provider,
      },
    },
    // `userId` est obligatoire sur `ExternalLink` depuis la revue du lot 1b :
    // c'est ce qui fait disparaître le lien avec le compte, au lieu de le
    // laisser en base sans que rien ne puisse le retrouver.
    create: {
      userId,
      entityType: ENTITY_CRA,
      entityId: craId,
      provider: connector.provider,
      externalId,
      syncState: 'EN_ATTENTE',
      syncedAt: maintenant,
    },
    update: { externalId, syncState: 'EN_ATTENTE', syncedAt: maintenant },
  })

  // **`transitionCra`, jamais un `cra.update` direct.** C'est l'unique point
  // qui consigne la transition au journal de preuve : écrire le statut à la
  // main ici rendait muet le geste central du lot, là où le bouton « Marquer
  // envoyé » produisait bien une entrée `cra.envoye`. L'historique d'un CRA
  // validé montrait alors `cra.ouvert` puis `cra.valide`, avec un trou au
  // milieu, et aucun abonné à `cra.envoye` n'apprenait que le document était
  // parti chez le client.
  const vue = await transitionCra(userId, craId, 'ENVOYER')

  // Et l'événement propre au lot 3, **après** la transition : le catalogue le
  // promet aux abonnés (`core/audit/events.ts`), et un nom proposé à
  // l'abonnement que personne n'émet est une promesse fausse.
  //
  // Ni le nom ni l'adresse du signataire n'y figurent : le journal est
  // conservé indéfiniment et poussé vers des URL tierces. Le destinataire
  // reste lisible sur la demande, qui, elle, ne sort pas.
  await appendAudit({
    ...(await actorOf(userId)),
    action: 'signature.envoyee',
    entityType: 'Cra',
    entityId: craId,
    payload: {
      missionId: cra.missionId,
      month: mois,
      provider: connector.provider,
      externalId,
    },
  })

  return { ok: true, externalId, status: vue.status }
}
