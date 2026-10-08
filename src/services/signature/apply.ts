import { prisma } from '@/db/client'
import { canTransition, InvalidTransitionError, type CraTransition } from '@/core/cra/state-machine'
import type { SignatureConnector, SignatureStatus } from '@/core/signature/connector'
import type { CraStatus } from '@/core/types'
import type { AuditAction } from '@/core/audit/events'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { transitionCra } from '@/services/cra'
import { libelleMois } from '@/core/cra/document'
import {
  gabaritRefusClient,
  gabaritRefusConsultant,
  gabaritValideClient,
  gabaritValideConsultant,
} from '@/core/notify/signature'
import type { Mailer, PieceJointe } from '@/services/notify'
import { nomFichierCra } from '@/services/cra-pdf'
import { envoyerCourriel } from './courriels'

export type SignatureEffet = 'VALIDE' | 'REFUSE' | 'EXPIRE' | 'AUCUN'

/** Les états d'une demande que le retour du prestataire peut encore trancher. */
const STATUTS_RECLAMABLES = ['EN_ATTENTE', 'EXPIRE']

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
 * **Idempotent et sûr en concurrence.** La confirmation de la page client, un
 * ou plusieurs webhooks et le balayage peuvent arriver au même instant. Deux
 * verrous, l'un après l'autre, font qu'un seul appel produit les effets :
 *
 * 1. **La demande est réclamée** par un compare-and-set (`updateMany` gardé
 *    sur l'état, l'enveloppe et le statut lus) **avant tout effet** —
 *    téléchargement, journal, courriels. Le second appel ne la trouve plus
 *    dans l'état attendu et rend `AUCUN`.
 * 2. **`transitionCra` garde son écriture** sur l'état du CRA. Si le CRA a
 *    quitté ENVOYE entre-temps (transition manuelle), elle lève
 *    `InvalidTransitionError` : on rend `AUCUN`, sans courriel ni journal.
 */
export async function applySignatureStatus(args: {
  craId: string
  externalId: string
  statut: SignatureStatus
  motifRefus?: string | null
  connector?: SignatureConnector | null
  mailer?: Mailer | null
}): Promise<SignatureEffet> {
  const cra = await prisma.cra.findUnique({
    where: { id: args.craId },
    select: { id: true, status: true, userId: true },
  })
  if (cra === null) return 'AUCUN'

  // **Seul l'envoi en cours fait foi.** Un webhook tardif d'une enveloppe
  // remplacée — refusée puis renvoyée, ou annulée — ne doit ni valider ni
  // refuser le nouvel envoi. Un envoi antérieur au lot 3b n'a pas
  // d'`externalId` sur sa demande : `ExternalLink` a déjà fait la
  // correspondance en amont.
  const demande = await prisma.signatureRequest.findUnique({
    where: { craId: args.craId },
    select: { externalId: true, status: true, completedAt: true, motifRefus: true },
  })
  if (demande !== null && demande.externalId !== '' && demande.externalId !== args.externalId) {
    return 'AUCUN'
  }
  if (demande?.status === 'ANNULE') return 'AUCUN'

  const maintenant = new Date()

  if (args.statut === 'EXPIRE') {
    // L'expiration est un fait du prestataire, pas une décision du client :
    // le CRA reste ENVOYE et remonte dans la liste des CRA en souffrance.
    // Gardée elle aussi : une expiration tardive n'écrase jamais une demande
    // déjà signée ou refusée.
    if (demande === null) return 'EXPIRE'
    const { count } = await prisma.signatureRequest.updateMany({
      where: { craId: args.craId, status: { in: STATUTS_RECLAMABLES } },
      data: { status: 'EXPIRE' },
    })
    return count === 1 ? 'EXPIRE' : 'AUCUN'
  }

  const transition = TRANSITION_PAR_STATUT[args.statut]
  if (transition === undefined) return 'AUCUN'

  // Pré-contrôle sur une lecture qui peut être périmée : il évite de réclamer
  // une demande pour un CRA qui n'est plus franchissable (validé ou refusé à
  // la main — sa demande reste alors intacte, ce que le balayage attend). La
  // garantie, elle, vient des deux compare-and-set qui suivent.
  const statut = cra.status as CraStatus
  if (!canTransition(statut, transition)) return 'AUCUN'

  // 1. La réclamation. Une demande déjà achevée (SIGNE, REFUSE) ne l'est pas :
  //    un rejeu — ou une relivraison après un ROUVRIR puis ENVOYER manuels,
  //    qui ne passent pas par une nouvelle enveloppe — ne revalide jamais un
  //    mois sur une signature donnée à un document antérieur.
  if (demande !== null) {
    if (!STATUTS_RECLAMABLES.includes(demande.status)) return 'AUCUN'
    const { count } = await prisma.signatureRequest.updateMany({
      where: { craId: args.craId, status: demande.status, externalId: demande.externalId },
      data: {
        status: args.statut,
        completedAt: maintenant,
        ...(args.statut === 'REFUSE' ? { motifRefus: (args.motifRefus ?? '').trim() } : {}),
      },
    })
    if (count !== 1) return 'AUCUN'
  }

  // 2. La transition, gardée sur l'état du CRA.
  try {
    await transitionCra(cra.userId, args.craId, transition)
  } catch (err) {
    // **La demande est restaurée** à ce qu'elle était — gardé sur ce qu'on
    // vient d'y écrire — quelle que soit l'erreur : sinon une panne (transaction,
    // file de synchro, lecture de l'armement Dolibarr) laisserait une demande
    // SIGNE/REFUSE face à un CRA resté ENVOYE, que ni le rafraîchissement, ni
    // le balayage (EN_ATTENTE seulement), ni un webhook relivré ne reprendraient :
    // un CRA signé coincé, sans courriel d'issue.
    if (demande !== null) {
      await prisma.signatureRequest.updateMany({
        where: { craId: args.craId, status: args.statut, completedAt: maintenant },
        data: {
          status: demande.status,
          completedAt: demande.completedAt,
          motifRefus: demande.motifRefus,
        },
      })
    }
    // Autre erreur : on la remonte, la demande est intacte et le rejeu aboutira.
    if (!(err instanceof InvalidTransitionError)) throw err
    // Le CRA a quitté ENVOYE entre la lecture et l'écriture : une transition
    // manuelle l'a emporté. La demande raconte la même histoire que le CRA :
    // rien n'a été signé ni refusé *par ce chemin* — c'est aussi l'état que
    // laisse le pré-contrôle quand la transition manuelle arrive plus tôt.
    return 'AUCUN'
  }

  // 3. Les effets, une seule fois. L'archive **avant** les courriels : le PDF
  //    signé s'y joint s'il a pu être téléchargé.
  if (args.statut === 'SIGNE') {
    await archiverSiPossible(args.craId, args.externalId, args.connector ?? null)
  }

  // Un abonné qui facture sur `signature.recue` ne facture pas deux fois le
  // même mois parce que le prestataire a relivré son webhook : seul l'appel
  // qui a réclamé la demande et franchi la transition arrive ici.
  await appendAudit({
    ...ACTEUR_SYSTEME,
    action: EVENEMENT_PAR_STATUT[args.statut]!,
    entityType: 'Cra',
    entityId: args.craId,
    payload: { statut: args.statut, statutAvant: statut },
  })

  await notifierIssue(args.craId, args.statut === 'SIGNE' ? 'VALIDE' : 'REFUSE', args.mailer ?? null)

  return args.statut === 'SIGNE' ? 'VALIDE' : 'REFUSE'
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

/**
 * Écrit au consultant et au client que le CRA est validé ou refusé.
 *
 * Le PDF signé est joint s'il est archivé ; sinon le courriel le dit, et le
 * document reste disponible dans l'outil dès son archivage. Rien ici ne lève :
 * `envoyerCourriel` absorbe et journalise toute panne.
 */
async function notifierIssue(
  craId: string,
  issue: 'VALIDE' | 'REFUSE',
  mailer: Mailer | null,
): Promise<void> {
  const cra = await prisma.cra.findUnique({
    where: { id: craId },
    select: {
      id: true,
      month: true,
      user: { select: { email: true } },
      mission: { select: { label: true, client: { select: { name: true } } } },
      signatureRequest: {
        select: {
          signataireNom: true,
          signataireEmail: true,
          motifRefus: true,
          signedPdf: true,
          origine: true,
        },
      },
    },
  })
  if (cra === null || cra.signatureRequest === null) return

  const d = cra.signatureRequest
  const mois = cra.month.toISOString().slice(0, 7)
  const contexte = {
    clientNom: cra.mission.client.name,
    missionLabel: cra.mission.label,
    moisLibelle: libelleMois(mois),
    signataireNom: d.signataireNom,
  }

  if (issue === 'VALIDE') {
    const pieces: PieceJointe[] =
      d.signedPdf == null
        ? []
        : [
            {
              nom: `${nomFichierCra(cra.mission.client.name, cra.mission.label, mois).replace(/\.pdf$/, '')}-signe.pdf`,
              type: 'application/pdf',
              octets: new Uint8Array(d.signedPdf),
            },
          ]
    const pdfJoint = pieces.length > 0
    await envoyerCourriel({ craId, raison: 'VALIDE_CONSULTANT', to: cra.user.email, gabarit: gabaritValideConsultant({ ...contexte, pdfJoint }), pieces, mailer })
    await envoyerCourriel({ craId, raison: 'VALIDE_CLIENT', to: d.signataireEmail, gabarit: gabaritValideClient({ ...contexte, pdfJoint }), pieces, mailer })
    return
  }

  const motif = d.motifRefus !== '' ? d.motifRefus : '(aucun motif indiqué)'
  const lienCra = d.origine !== '' ? `${d.origine}/cra/${craId}` : `/cra/${craId}`
  await envoyerCourriel({ craId, raison: 'REFUSE_CONSULTANT', to: cra.user.email, gabarit: gabaritRefusConsultant({ ...contexte, motif, lienCra }), mailer })
  await envoyerCourriel({ craId, raison: 'REFUSE_CLIENT', to: d.signataireEmail, gabarit: gabaritRefusClient({ ...contexte, motif }), mailer })
}
