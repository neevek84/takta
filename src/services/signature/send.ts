import { prisma } from '@/db/client'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import { libelleMois } from '@/core/cra/document'
import { figerContenu } from '@/core/signature/contenu-fige'
import { gabaritEnvoiClient } from '@/core/notify/signature'
import type { SignatureConnector, SignatureDepot } from '@/core/signature/connector'
import type { CraStatus } from '@/core/types'
import { actorOf, appendAudit } from '@/services/audit'
import { transitionCra } from '@/services/cra'
import { buildCraPdf } from '@/services/cra-pdf'
import { readSmtpConfig, type Mailer } from '@/services/notify'
import { ENTITY_CRA } from './constants'
import { envoyerCourriel } from './courriels'
import { cloreEnvoiCourant } from './envois'
import { creerLienClient, revoquerLiensDuCra } from './lien-client'
import { getSignatureConnector } from './registry'

export type SendCraRaison =
  | 'PAS_DE_CONNECTEUR'
  | 'PAS_DE_SIGNATAIRE'
  | 'PAS_D_ORIGINE'
  | 'TRANSITION_IMPOSSIBLE'
  | 'CONNECTEUR_EN_ECHEC'
  | 'PAS_DE_SMTP'

export type SendCraResult =
  | { ok: true; externalId: string; status: CraStatus; numero: number; courrielEnvoye: boolean }
  | { ok: false; raison: SendCraRaison; message: string }

const MESSAGES: Record<SendCraRaison, string> = {
  PAS_DE_CONNECTEUR:
    'Aucun outil de signature n’est configuré. Le CRA reste téléchargeable et les transitions manuelles restent disponibles.',
  PAS_DE_SIGNATAIRE:
    'Renseignez le signataire de la mission (nom et adresse électronique) avant d’envoyer le CRA.',
  PAS_D_ORIGINE:
    'L’adresse publique de l’outil est inconnue : le lien envoyé au client serait inutilisable.',
  TRANSITION_IMPOSSIBLE: 'Ce CRA ne peut pas être envoyé dans son état actuel.',
  CONNECTEUR_EN_ECHEC:
    'L’outil de signature n’a pas accepté le document. Le CRA n’a pas changé d’état.',
  PAS_DE_SMTP:
    'Le serveur de courriel n’est pas configuré : le client ne pourrait pas recevoir son code. Configurez SMTP dans l’administration, ou utilisez les transitions manuelles.',
}

/** Sentinelle : un autre appel a pris le CRA entre la lecture et la transaction. */
class EnvoiConcurrent extends Error {}

function echec(raison: SendCraRaison): SendCraResult {
  return { ok: false, raison, message: MESSAGES[raison] }
}

/**
 * Envoie le CRA au signataire de sa mission — premier envoi depuis
 * `BROUILLON`, ou renvoi depuis `REFUSE`.
 *
 * **L'ordre des opérations est la garantie du circuit** : le document est
 * composé et figé, confié au connecteur, et seulement ensuite l'envoi
 * précédent est clos, le nouvel envoi écrit et le CRA transitionné. Un échec
 * du prestataire ne laisse donc rien derrière lui.
 *
 * Le courriel part **en dernier**, et son échec ne défait rien : le CRA est
 * chez le prestataire, le lien existe, et l'écran du CRA permet d'en copier
 * un à la main.
 */
export async function sendCraForSignature(
  userId: string,
  craId: string,
  options: { connector?: SignatureConnector | null; origine?: string; mailer?: Mailer | null } = {},
): Promise<SendCraResult> {
  const cra = await prisma.cra.findFirst({
    where: { id: craId, userId },
    include: { mission: { include: { client: true } } },
  })
  if (cra === null) return echec('TRANSITION_IMPOSSIBLE')

  const statut = cra.status as CraStatus
  const transition: CraTransition | null = canTransition(statut, 'ENVOYER')
    ? 'ENVOYER'
    : canTransition(statut, 'RENVOYER')
      ? 'RENVOYER'
      : null
  if (transition === null) return echec('TRANSITION_IMPOSSIBLE')

  const destinataire = { nom: cra.mission.signataireNom, email: cra.mission.signataireEmail }
  if (destinataire.email === '' || destinataire.nom === '') return echec('PAS_DE_SIGNATAIRE')

  const origine = (options.origine ?? '').replace(/\/+$/, '')
  if (origine === '') return echec('PAS_D_ORIGINE')

  const connector =
    options.connector !== undefined ? options.connector : await getSignatureConnector()
  if (connector === null) return echec('PAS_DE_CONNECTEUR')

  // **SMTP est un prérequis du circuit, pas une option.** Le client n'ouvre
  // son lien qu'avec un code reçu par courriel : sans serveur de courriel,
  // chaque envoi produirait un lien que personne ne peut ouvrir. Refusé avant
  // le prestataire, donc sans rien laisser derrière. Un `mailer` injecté
  // (tests, intégrations) tient lieu de SMTP.
  if (options.mailer == null && (await readSmtpConfig()) === null) return echec('PAS_DE_SMTP')

  const { fileName, bytes, champs, document } = await buildCraPdf(userId, craId)
  const { json, empreinte } = figerContenu(document)
  const mois = cra.month.toISOString().slice(0, 7)
  const titre = `CRA ${cra.mission.client.name} — ${cra.mission.label} — ${libelleMois(mois)}`

  let depot: SignatureDepot
  try {
    depot = await connector.send({ titre, fileName, pdf: bytes, destinataire, champs, reference: craId })
  } catch {
    // Le message du prestataire n'est pas propagé : il finit sous les yeux de
    // l'utilisateur et peut porter ce que la requête contenait.
    return echec('CONNECTEUR_EN_ECHEC')
  }

  const maintenant = new Date()
  let numero = 0

  let jeton: string
  try {
    jeton = await prisma.$transaction(async (tx) => {
    // Prise de possession optimiste : si le CRA a bougé depuis la lecture
    // (double envoi, autre onglet), on annule tout plutôt que d'écraser
    // l'envoi que l'autre appel vient de faire partir.
    const claim = await tx.cra.updateMany({
      where: { id: craId, status: statut, updatedAt: cra.updatedAt },
      data: { updatedAt: new Date() },
    })
    if (claim.count !== 1) throw new EnvoiConcurrent()
    const precedent = await tx.signatureRequest.findUnique({ where: { craId }, select: { numero: true } })
    numero = (precedent?.numero ?? 0) + 1

    await cloreEnvoiCourant(tx, craId, maintenant)
    await revoquerLiensDuCra(tx, craId, maintenant)

    // Une seule demande par CRA : l'envoi précédent vient d'être recopié dans
    // `SignatureEnvoiClos`, on le remplace — relances, abandon, archive et
    // motif repartent de zéro.
    const champsEnvoi = {
      provider: connector.provider,
      status: 'EN_ATTENTE',
      numero,
      externalId: depot.externalId,
      motifRefus: '',
      contenuFige: json,
      empreinte,
      origine,
      signataireNom: destinataire.nom,
      signataireEmail: destinataire.email,
      sentAt: maintenant,
      relances: 0,
      lastRelanceAt: null,
      completedAt: null,
      abandoned: false,
      signedPdf: null,
    }
    await tx.signatureRequest.upsert({
      where: { craId },
      create: { craId, ...champsEnvoi },
      update: champsEnvoi,
    })

    await tx.externalLink.upsert({
      where: {
        entityType_entityId_provider: { entityType: ENTITY_CRA, entityId: craId, provider: connector.provider },
      },
      create: {
        userId,
        entityType: ENTITY_CRA,
        entityId: craId,
        provider: connector.provider,
        externalId: depot.externalId,
        syncState: 'EN_ATTENTE',
        syncedAt: maintenant,
      },
      update: { externalId: depot.externalId, syncState: 'EN_ATTENTE', syncedAt: maintenant },
    })

    return creerLienClient(tx, { craId, numero, jetonSignataire: depot.jetonSignataire })
    })
  } catch (e) {
    if (e instanceof EnvoiConcurrent) {
      // L'enveloppe créée chez le prestataire est orpheline : on la retire, au mieux.
      await connector.annuler(depot.externalId).catch(() => {})
      return echec('TRANSITION_IMPOSSIBLE')
    }
    throw e
  }

  // `transitionCra`, jamais un `cra.update` direct : c'est lui qui consigne
  // `cra.envoye` au journal.
  const vue = await transitionCra(userId, craId, transition)

  const acteur = await actorOf(userId)
  const charge = { missionId: cra.missionId, month: mois, provider: connector.provider, externalId: depot.externalId, numero, empreinte }
  await appendAudit({ ...acteur, action: 'signature.envoyee', entityType: 'Cra', entityId: craId, payload: charge })
  if (transition === 'RENVOYER') {
    await appendAudit({ ...acteur, action: 'signature.renvoyee', entityType: 'Cra', entityId: craId, payload: charge })
  }

  const courriel = await envoyerCourriel({
    craId,
    raison: 'ENVOI',
    to: destinataire.email,
    gabarit: gabaritEnvoiClient({
      clientNom: cra.mission.client.name,
      missionLabel: cra.mission.label,
      moisLibelle: libelleMois(mois),
      signataireNom: destinataire.nom,
      lien: `${origine}/v/${jeton}`,
    }),
    mailer: options.mailer ?? null,
  })

  return { ok: true, externalId: depot.externalId, status: vue.status, numero, courrielEnvoye: courriel.envoye }
}
