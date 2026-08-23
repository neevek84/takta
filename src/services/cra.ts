import { prisma } from '@/db/client'
import {
  annulerPrevisionnelDuMois,
  compterPrevisionnelParMission,
} from './cra-previsionnel'
import { missionsArmeesPourDolibarr } from './dolibarr/push'
import { syntheseParMission, SYNTHESE_VIDE, type SyntheseCra } from './cra-synthese'
import { applyTransition, type CraTransition } from '@/core/cra/state-machine'
import { ENTITY_CRA } from '@/core/sync/policy'
import type { SignatureStatus } from '@/core/signature/connector'
import type { CraStatus } from '@/core/types'
import type { AuditAction } from '@/core/audit/events'
import { DOLIBARR } from './dolibarr/api'
import { isDolibarrPushArmed } from './dolibarr/push'
import { enqueueSync } from './sync/outbox'
import { appendAudit, actorOf } from './audit'

/**
 * Chaque transition porte son propre nom au journal. Un unique
 * `cra.transitionne` obligerait tout abonné à ouvrir la charge utile pour
 * savoir de quoi il s'agit — et rendrait impossible de s'abonner à la seule
 * validation, qui est précisément ce que tout le monde attend.
 *
 * `Record<CraTransition, AuditAction>` et non un objet libre : ajouter une
 * transition à la machine à états sans lui donner d'événement ne compilera
 * pas, plutôt que de passer silencieusement.
 */
const ACTION_PAR_TRANSITION: Record<CraTransition, AuditAction> = {
  ENVOYER: 'cra.envoye',
  VALIDER: 'cra.valide',
  REFUSER: 'cra.refuse',
  ROUVRIR: 'cra.rouvert',
}

export interface CraSignatureView {
  provider: string
  status: SignatureStatus
  sentAt: Date
  relances: number
  lastRelanceAt: Date | null
  /** trois relances sans réponse : visible dans la liste des CRA en souffrance */
  abandoned: boolean
  /** un PDF signé est archivé, et sera servi tel quel au téléchargement */
  archive: boolean
}

export interface CraView {
  id: string
  missionId: string
  missionLabel: string
  clientName: string
  /** 'YYYY-MM' */
  month: string
  status: CraStatus
  invoiceNumber: string | null
  invoicedAt: Date | null
  paidAt: Date | null
  /** signataire porté par la mission, vide tant qu'il n'est pas renseigné */
  signataireNom: string
  signataireEmail: string
  /** null tant qu'aucune demande de signature n'a été ouverte */
  signature: CraSignatureView | null
  /**
   * Les jours **prévisionnels** que ce mois porte encore, et que la validation
   * annulera.
   *
   * Annoncé ici pour être dit **avant** la validation : un jour prévu emporté
   * sans préavis est une donnée perdue dont personne ne saura qu'elle a
   * existé. Vaut 0 sur un CRA déjà validé — il n'y a plus rien à annoncer.
   */
  previsionnelAAnnuler: number
  /**
   * Ce CRA partira-t-il chez Dolibarr à sa validation ?
   *
   * `false` n'est pas une anomalie — l'immense majorité des installations n'a
   * pas de Dolibarr. Mais quand il est connecté et que la mission n'y est pas
   * rattachée, un CRA validé ne met **rien** en file : rien n'arrive chez le
   * client, l'écran de synchronisation reste muet, et on ne s'en aperçoit
   * qu'à la facture manquante. C'est exactement ce qui est arrivé le
   * 20 août 2026, sur deux missions aux noms presque identiques.
   */
  iraDansDolibarr: boolean
  /**
   * Ce que ce CRA porte, en un coup d'œil : le réalisé du mois, prestation par
   * prestation.
   *
   * C'est ce que le client signera. Sans lui, la carte ne disait ni combien de
   * jours, ni sur quoi — il fallait ouvrir le PDF pour savoir ce qu'on
   * s'apprêtait à envoyer.
   */
  synthese: {
    totalCentiemes: number
    /** nombre de journées servies, quelle que soit leur quantité */
    joursServis: number
    lignes: Array<{ label: string; centiemes: number }>
  }
}

const WITH_MISSION = {
  mission: { include: { client: true } },
  signatureRequest: {
    select: {
      provider: true,
      status: true,
      sentAt: true,
      relances: true,
      lastRelanceAt: true,
      abandoned: true,
      // `signedPdf` n'est JAMAIS sélectionné ici : un blob de plusieurs
      // centaines de kilo-octets par ligne traverserait chaque affichage de
      // la page CRA pour un booléen. Sa présence se lit par un compte —
      // `craAvecArchive` — et `cra.test.ts` interdit statiquement de
      // l'ajouter à cette projection.
    },
  },
} as const

type Row = {
  id: string
  missionId: string
  month: Date
  status: string
  invoiceNumber: string | null
  invoicedAt: Date | null
  paidAt: Date | null
  mission: { label: string; signataireNom: string; signataireEmail: string; client: { name: string } }
  signatureRequest: {
    provider: string
    status: string
    sentAt: Date
    relances: number
    lastRelanceAt: Date | null
    abandoned: boolean
  } | null
}

/** Identifiants des CRA dont le PDF signé est archivé, sans charger les octets. */
async function craAvecArchive(craIds: string[]): Promise<Set<string>> {
  if (craIds.length === 0) return new Set()
  const lignes = await prisma.signatureRequest.findMany({
    where: { craId: { in: craIds }, NOT: { signedPdf: null } },
    select: { craId: true },
  })
  return new Set(lignes.map((l) => l.craId))
}

function toView(
  row: Row,
  archives: Set<string>,
  previsionnel = 0,
  iraDansDolibarr = false,
  synthese: SyntheseCra = SYNTHESE_VIDE,
): CraView {
  return {
    id: row.id,
    missionId: row.missionId,
    missionLabel: row.mission.label,
    clientName: row.mission.client.name,
    month: row.month.toISOString().slice(0, 7),
    status: row.status as CraStatus,
    invoiceNumber: row.invoiceNumber,
    invoicedAt: row.invoicedAt,
    paidAt: row.paidAt,
    signataireNom: row.mission.signataireNom,
    signataireEmail: row.mission.signataireEmail,
    previsionnelAAnnuler: previsionnel,
    iraDansDolibarr,
    synthese,
    signature:
      row.signatureRequest === null
        ? null
        : {
            provider: row.signatureRequest.provider,
            status: row.signatureRequest.status as SignatureStatus,
            sentAt: row.signatureRequest.sentAt,
            relances: row.signatureRequest.relances,
            lastRelanceAt: row.signatureRequest.lastRelanceAt,
            abandoned: row.signatureRequest.abandoned,
            archive: archives.has(row.id),
          },
  }
}

function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`)
}

/**
 * Une lecture puis une création, et non un `upsert` : un `upsert` ne dit pas
 * s'il a créé. Consigner une ouverture à chaque affichage de la page noierait
 * le journal sous un événement qui ne raconte rien — le CRA n'est ouvert
 * qu'une fois.
 */
export async function getOrCreateCra(
  userId: string,
  missionId: string,
  month: string,
): Promise<CraView> {
  const cle = { missionId_userId_month: { missionId, userId, month: monthStart(month) } }

  const existant = await prisma.cra.findUnique({ where: cle, include: WITH_MISSION })
  if (existant !== null) return toView(existant, await craAvecArchive([existant.id]))

  let row
  try {
    row = await prisma.cra.create({
      data: { missionId, userId, month: monthStart(month) },
      include: WITH_MISSION,
    })
  } catch {
    // Course avec un autre rendu de la même page : le CRA existe désormais,
    // et il n'a été « ouvert » qu'une fois — c'est l'autre rendu qui l'a
    // consigné.
    const relu = await prisma.cra.findUniqueOrThrow({ where: cle, include: WITH_MISSION })
    return toView(relu, await craAvecArchive([relu.id]))
  }

  await appendAudit({
    ...(await actorOf(userId)),
    action: 'cra.ouvert',
    entityType: 'Cra',
    entityId: row.id,
    payload: { missionId, month, status: row.status },
  })

  return toView(row, await craAvecArchive([row.id]))
}

/**
 * Fait passer un CRA d'un état à l'autre — et, quand la transition le valide,
 * inscrit ses temps dans la file de synchronisation.
 *
 * **La validation est le déclencheur, et le seul.** C'est le moment où le mois
 * est arrêté : le CRA est fait, envoyé, validé par le client, et les temps
 * consommés peuvent partir chez Dolibarr. Aucun autre passage n'en met en
 * file — pousser un brouillon enverrait du temps qui n'est pas arrêté, et la
 * réconciliation du push retirerait de Dolibarr les journées que l'utilisateur
 * est justement en train de corriger.
 *
 * **Rien de Dolibarr n'est appelé ici.** La fonction écrit en base et met en
 * file, un point : c'est ce qui garantit qu'une instance éteinte ne peut jamais
 * empêcher de valider un CRA. Le drainage, lui, tourne plus tard et rejouera.
 *
 * **Et la facture ?** Elle n'est pas ici, et elle ne sera jamais calculée ici :
 * Dolibarr facture, pas le CRA. L'application ne demande aucune facture — elle
 * pousse les temps consommés, et le porteur les facture depuis le projet
 * Dolibarr, là où chaque ligne de temps passe de « Facturée : Non » à la
 * référence de sa facture. Les champs `invoiceNumber`, `invoicedAt` et `paidAt`
 * du CRA sont un suivi saisi à la main, pas le produit d'un calcul.
 */
export async function transitionCra(
  userId: string,
  craId: string,
  t: CraTransition,
): Promise<CraView> {
  // Le scope par userId est la garantie qu'on n'agit jamais sur le CRA d'un autre.
  const current = await prisma.cra.findFirstOrThrow({ where: { id: craId, userId } })
  const next = applyTransition(current.status as CraStatus, t)

  // Lu **avant** la transaction : deux lectures, aucun appel réseau, et rien
  // qui ait à tenir le verrou d'écriture.
  const arme = next === 'VALIDE' && (await isDolibarrPushArmed(current.missionId))

  let previsionnelAnnule = 0
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.cra.update({
      where: { id: craId },
      data: { status: next },
      include: WITH_MISSION,
    })

    // La mise en file est transactionnelle avec le changement d'état, dans les
    // deux sens. Un CRA validé sans ligne de file, c'est un mois verrouillé
    // que plus rien ne poussera jamais : Dolibarr resterait vide, l'écran de
    // synchronisation muet, et personne ne le saurait avant la facture
    // manquante. Une ligne sans validation, à l'inverse, ferait pousser des
    // temps que l'utilisateur peut encore modifier.
    //
    // Le `payload` reste vide, comme pour l'agenda : la cible est un CRA, et
    // un CRA se relit. Le drainage retrouve mission, mois et saisies en base
    // au moment où il pousse — y figer le mois ici ne servirait qu'à porter
    // une copie qui peut devenir fausse.
    if (arme) {
      await enqueueSync(tx, {
        userId,
        entityType: ENTITY_CRA,
        entityId: craId,
        provider: DOLIBARR,
      })
    }

    // Un mois validé est un mois clos : un jour qui y était **prévu** et qui
    // n'a pas eu lieu n'aura plus lieu. Le laisser vivre le figerait pour
    // toujours — ni réalisable, ni annulable — tout en le comptant comme
    // consommé sur l'engagement de la mission. L'annulation tombe donc dans la
    // même transaction que la validation.
    if (next === 'VALIDE') {
      previsionnelAnnule = await annulerPrevisionnelDuMois(tx, {
        userId,
        missionId: updated.missionId,
        month: updated.month.toISOString().slice(0, 7),
      })
    }

    return updated
  })

  // Consigné après la transaction : le journal atteste de ce qui a eu lieu, et
  // une transaction annulée n'a rien fait avoir lieu. `applyTransition` lève
  // **avant** l'écriture — une transition impossible ne laisse donc rien ici
  // sans qu'aucune garde supplémentaire soit nécessaire.
  await appendAudit({
    ...(await actorOf(userId)),
    action: ACTION_PAR_TRANSITION[t],
    entityType: 'Cra',
    entityId: craId,
    payload: {
      missionId: row.missionId,
      month: row.month.toISOString().slice(0, 7),
      statutAvant: current.status,
      statutApres: next,
      // Ce qui a été emporté par la validation. Zéro est une information : il
      // dit que le mois n'avait rien de prévu, pas qu'on n'a pas regardé.
      ...(next === 'VALIDE' ? { previsionnelAnnule } : {}),
    },
  })

  return toView(row, await craAvecArchive([row.id]))
}

/**
 * Le suivi de facturation, **saisi à la main** : l'application ne facture pas,
 * et ces trois champs ne sont le produit d'aucun calcul.
 *
 * Consigné sous `facturation.renseignee`. C'est l'événement qui a remplacé
 * `facture.demandee` de la spec du lot 4 : la demande de facture à Dolibarr a
 * été retirée du produit (commit `c1aeb8c`), mais dire « cette prestation est
 * facturée, à ce numéro, payée à cette date » reste un acte qui engage.
 *
 * Seules les clés effectivement présentes au patch sont consignées : recopier
 * les trois champs à chaque enregistrement ferait croire qu'on a touché à ce
 * qu'on n'a pas touché.
 */
export async function updateInvoiceTracking(
  userId: string,
  craId: string,
  patch: { invoiceNumber?: string | null; invoicedAt?: Date | null; paidAt?: Date | null },
): Promise<CraView> {
  await prisma.cra.findFirstOrThrow({ where: { id: craId, userId } })

  const row = await prisma.cra.update({
    where: { id: craId },
    data: patch,
    include: WITH_MISSION,
  })

  await appendAudit({
    ...(await actorOf(userId)),
    action: 'facturation.renseignee',
    entityType: 'Cra',
    entityId: craId,
    payload: {
      cles: Object.keys(patch),
      month: row.month.toISOString().slice(0, 7),
      ...(patch.invoiceNumber !== undefined && { invoiceNumber: patch.invoiceNumber }),
      ...(patch.invoicedAt !== undefined && {
        invoicedAt: patch.invoicedAt?.toISOString() ?? null,
      }),
      ...(patch.paidAt !== undefined && { paidAt: patch.paidAt?.toISOString() ?? null }),
    },
  })

  return toView(row, await craAvecArchive([row.id]))
}

/**
 * Un CRA, complet, pour sa page de détail.
 *
 * Les fonctions de lot sont appelées avec un seul identifiant plutôt que
 * réécrites pour l'unité : un second chemin de calcul finirait par diverger du
 * premier, et la liste et le détail afficheraient alors deux chiffres pour le
 * même CRA.
 *
 * `findFirstOrThrow` et non `findUnique` : le scope par `userId` fait partie
 * de la requête, il n'est pas vérifié après coup. C'est ce qui garantit qu'on
 * ne sert jamais le CRA d'un autre, même en connaissant son identifiant.
 */
export async function getCra(userId: string, craId: string): Promise<CraView> {
  const row = await prisma.cra.findFirstOrThrow({
    where: { id: craId, userId },
    include: WITH_MISSION,
  })

  const month = row.month.toISOString().slice(0, 7)
  const archives = await craAvecArchive([row.id])
  const previsionnel = await compterPrevisionnelParMission({
    userId,
    missionIds: [row.missionId],
    month,
  })
  const armees = await missionsArmeesPourDolibarr([row.missionId])
  const syntheses = await syntheseParMission({ userId, missionIds: [row.missionId], month })

  return toView(
    row,
    archives,
    row.status === 'VALIDE' ? 0 : (previsionnel.get(row.missionId) ?? 0),
    armees.has(row.missionId),
    syntheses.get(row.missionId) ?? SYNTHESE_VIDE,
  )
}

export async function listCras(userId: string, month: string): Promise<CraView[]> {
  const rows = await prisma.cra.findMany({
    where: { userId, month: monthStart(month) },
    include: WITH_MISSION,
    orderBy: { mission: { label: 'asc' } },
  })
  const archives = await craAvecArchive(rows.map((r) => r.id))
  // Une seule requête pour toute la liste : une par CRA ferait payer l'écran
  // au nombre de missions.
  const previsionnel = await compterPrevisionnelParMission({
    userId,
    missionIds: rows.map((r) => r.missionId),
    month,
  })
  // Une seule lecture des correspondances pour toute la liste : `isDolibarrPushArmed`
  // en ferait une par CRA, et l'écran en affiche autant que de missions.
  const armees = await missionsArmeesPourDolibarr(rows.map((r) => r.missionId))
  const syntheses = await syntheseParMission({
    userId,
    missionIds: rows.map((r) => r.missionId),
    month,
  })

  return rows.map((row) =>
    // Un CRA déjà validé n'a plus rien à annoncer : son prévisionnel a été
    // emporté au moment où il l'a été.
    toView(
      row,
      archives,
      row.status === 'VALIDE' ? 0 : (previsionnel.get(row.missionId) ?? 0),
      armees.has(row.missionId),
      syntheses.get(row.missionId) ?? SYNTHESE_VIDE,
    ),
  )
}

export interface CraNonCloture {
  missionId: string
  missionLabel: string
  clientName: string
  /** 'ABSENT' quand aucune ligne de CRA n'existe encore pour ce mois */
  status: CraStatus | 'ABSENT'
}

/**
 * Les missions saisies sur un mois dont le CRA n'est pas parti.
 *
 * **Ne crée rien** : un rappel qui ouvrirait des CRA pour pouvoir annoncer
 * qu'ils sont ouverts serait absurde, et écrire depuis un traitement de fond
 * est précisément ce que ce lot s'interdit.
 *
 * À ne pas confondre avec `listCrasEnSouffrance`, qui désigne les CRA **déjà
 * envoyés** qu'aucune relance n'a fait revenir : ici, rien n'est encore
 * parti.
 */
export async function listCrasNonClotures(
  userId: string,
  month: string,
): Promise<CraNonCloture[]> {
  const debut = monthStart(month)
  const fin = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + 1, 1))

  const saisies = await prisma.timeEntry.findMany({
    where: { userId, date: { gte: debut, lt: fin } },
    select: {
      line: {
        select: {
          missionId: true,
          mission: { select: { label: true, client: { select: { name: true } } } },
        },
      },
    },
  })

  const missions = new Map<string, { missionLabel: string; clientName: string }>()
  for (const s of saisies) {
    missions.set(s.line.missionId, {
      missionLabel: s.line.mission.label,
      clientName: s.line.mission.client.name,
    })
  }
  if (missions.size === 0) return []

  const cras = await prisma.cra.findMany({
    where: { userId, month: debut, missionId: { in: [...missions.keys()] } },
    select: { missionId: true, status: true },
  })
  const statutParMission = new Map(cras.map((c) => [c.missionId, c.status as CraStatus]))

  const out: CraNonCloture[] = []
  for (const [missionId, info] of missions) {
    const status = statutParMission.get(missionId)
    // Envoyé, validé ou refusé : le CRA a quitté le brouillon, il n'est plus
    // « à clôturer ».
    if (status !== undefined && status !== 'BROUILLON') continue
    out.push({ missionId, ...info, status: status ?? 'ABSENT' })
  }
  return out.sort((a, b) => a.missionLabel.localeCompare(b.missionLabel, 'fr'))
}

/**
 * Les CRA envoyés dont la signature ne reviendra pas d'elle-même.
 *
 * Deux situations, et c'est volontairement une union :
 *
 *   - **trois relances sans réponse** (`abandoned`) : le circuit automatique a
 *     rendu la main ;
 *   - **une demande expirée chez le prestataire** : plus personne ne peut la
 *     signer, et elle n'est plus relancée non plus. Sans cette branche, un
 *     document expiré laissait un CRA bloqué en `ENVOYE`, absent de cette
 *     liste comme des alertes — alors que le commentaire d'`apply.ts` annonce
 *     exactement l'inverse.
 *
 * Ils restent `ENVOYE` — on ne les annule pas de force : c'est un problème
 * humain, et le rendre visible est tout ce que le logiciel peut faire. C'est
 * aussi pourquoi l'état du CRA fait partie du filtre : un CRA validé ou refusé
 * à la main depuis n'est plus en souffrance, quoi que sa demande raconte, et
 * l'y laisser enverrait le porteur relancer un client sur un mois déjà clos.
 */
export async function listCrasEnSouffrance(userId: string): Promise<CraView[]> {
  const rows = await prisma.cra.findMany({
    where: {
      userId,
      status: 'ENVOYE',
      signatureRequest: {
        OR: [{ abandoned: true, status: 'EN_ATTENTE' }, { status: 'EXPIRE' }],
      },
    },
    include: WITH_MISSION,
    orderBy: { month: 'asc' },
  })
  const archives = await craAvecArchive(rows.map((r) => r.id))
  return rows.map((row) => toView(row, archives))
}
