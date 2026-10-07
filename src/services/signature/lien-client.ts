/**
 * Le lien que reçoit le client, et ce qu'il ouvre.
 *
 * **Ces fonctions n'ont pas de `userId`** — sauf `nouveauLienManuel`. Elles
 * servent la seule page de l'outil sans session : leur garde est le jeton
 * (256 bits, empreinte seule en base), puis le code à usage unique, puis la
 * session client signée. Elles ne lisent jamais que le CRA du lien.
 */
import { timingSafeEqual } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import { empreinteJeton, fabriquerJeton } from '@/core/auth/reinitialisation'
import type { CraDocument } from '@/core/cra/document'
import {
  CODE_DUREE_MINUTES,
  CODE_ESSAIS_MAX,
  CODES_PAR_HEURE_MAX,
  empreinteCode,
  fabriquerCode,
  masquerEmail,
} from '@/core/signature/code-client'
import { lireContenu } from '@/core/signature/contenu-fige'
import { gabaritCodeClient } from '@/core/notify/signature'
import type { SignatureConnector } from '@/core/signature/connector'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { nomFichierCra } from '@/services/cra-pdf'
import type { Mailer } from '@/services/notify'
import { applySignatureStatus } from './apply'
import { envoyerCourriel } from './courriels'
import { getSignatureConnector } from './registry'

/**
 * Le secret qui signe les sessions client et protège les empreintes de code.
 * `AUTH_SECRET` : celui qu'Auth.js exige déjà. Vide en dehors d'une
 * installation configurée — alors aucune session client n'est valide
 * (`lireSessionClient` refuse tout), jamais l'inverse.
 */
export function secretClient(): string {
  return process.env.AUTH_SECRET ?? ''
}

/**
 * Crée un lien pour l'envoi `numero` du CRA et rend **le jeton en clair**.
 *
 * C'est la seule fois qu'il existe en clair : il part dans un courriel, la base
 * n'en garde que l'empreinte — le procédé de la réinitialisation de mot de
 * passe, réutilisé tel quel. Plusieurs liens peuvent servir le même envoi
 * (courriel d'origine, relances, lien copié à la main) : aucun n'invalide les
 * autres ; seul un renvoi ou une annulation les révoque tous.
 */
export async function creerLienClient(
  tx: Prisma.TransactionClient,
  args: { craId: string; numero: number; jetonSignataire: string },
): Promise<string> {
  const jeton = fabriquerJeton()
  await tx.lienClient.create({
    data: {
      craId: args.craId,
      numero: args.numero,
      jetonEmpreinte: empreinteJeton(jeton),
      jetonSignataire: args.jetonSignataire,
    },
  })
  return jeton
}

/** Révoque tous les liens encore ouverts du CRA. */
export async function revoquerLiensDuCra(
  tx: Prisma.TransactionClient,
  craId: string,
  maintenant: Date,
): Promise<void> {
  await tx.lienClient.updateMany({ where: { craId, revokedAt: null }, data: { revokedAt: maintenant } })
}

const HEURE_MS = 60 * 60_000

export type EtatLien = 'INCONNU' | 'ACTIF' | 'REMPLACE' | 'RETIRE'

async function journal(craId: string, action: 'signature.lien.ouvert' | 'signature.code.envoye' | 'signature.code.valide' | 'signature.code.echoue', numero: number) {
  await appendAudit({ ...ACTEUR_SYSTEME, action, entityType: 'Cra', entityId: craId, payload: { numero } })
}

/**
 * L'état d'un lien. **Ne lève jamais** et ne dit rien de plus que nécessaire :
 * un jeton mal formé et un jeton inconnu rendent la même chose.
 */
export async function resoudreLien(jeton: string): Promise<{ etat: EtatLien; lienId: string | null }> {
  const inconnu = { etat: 'INCONNU' as const, lienId: null }
  if (!/^[0-9a-f]{64}$/.test(jeton)) return inconnu

  const lien = await prisma.lienClient.findUnique({
    where: { jetonEmpreinte: empreinteJeton(jeton) },
    select: { id: true, craId: true, numero: true, revokedAt: true },
  })
  if (lien === null) return inconnu

  const demande = await prisma.signatureRequest.findUnique({
    where: { craId: lien.craId },
    select: { numero: true, status: true },
  })
  if (demande === null) return inconnu
  if (lien.numero < demande.numero) return { etat: 'REMPLACE', lienId: lien.id }
  if (lien.revokedAt !== null || demande.status === 'ANNULE') return { etat: 'RETIRE', lienId: lien.id }
  return { etat: 'ACTIF', lienId: lien.id }
}

export async function demanderCode(
  jeton: string,
  deps: { maintenant?: Date; mailer?: Mailer | null } = {},
): Promise<{ ok: true; adresseMasquee: string } | { ok: false; raison: 'LIEN' | 'TROP_DE_CODES' }> {
  const maintenant = deps.maintenant ?? new Date()
  const { etat, lienId } = await resoudreLien(jeton)
  if (etat !== 'ACTIF' || lienId === null) return { ok: false, raison: 'LIEN' }

  const lien = await prisma.lienClient.findUniqueOrThrow({ where: { id: lienId } })
  const demande = await prisma.signatureRequest.findUniqueOrThrow({
    where: { craId: lien.craId },
    select: { signataireEmail: true },
  })

  const fenetreNeuve =
    lien.codesFenetreAt === null || maintenant.getTime() - lien.codesFenetreAt.getTime() >= HEURE_MS
  const envoyes = fenetreNeuve ? 0 : lien.codesEnvoyes
  if (envoyes >= CODES_PAR_HEURE_MAX) return { ok: false, raison: 'TROP_DE_CODES' }

  const code = fabriquerCode()
  // Un nouveau code remplace le précédent et remet les essais à zéro : seul le
  // dernier code reçu vaut.
  await prisma.lienClient.update({
    where: { id: lien.id },
    data: {
      codeEmpreinte: empreinteCode(lien.id, code, secretClient()),
      codeExpireAt: new Date(maintenant.getTime() + CODE_DUREE_MINUTES * 60_000),
      codeEssais: 0,
      codesEnvoyes: envoyes + 1,
      codesFenetreAt: fenetreNeuve ? maintenant : lien.codesFenetreAt,
    },
  })

  // À l'adresse **figée à l'envoi**, jamais à celle de la mission aujourd'hui :
  // un lien transféré ne fait pas changer le destinataire du code.
  await envoyerCourriel({
    craId: lien.craId,
    raison: 'CODE',
    to: demande.signataireEmail,
    gabarit: gabaritCodeClient({ code, minutes: CODE_DUREE_MINUTES }),
    mailer: deps.mailer ?? null,
  })
  await journal(lien.craId, 'signature.code.envoye', lien.numero)

  return { ok: true, adresseMasquee: masquerEmail(demande.signataireEmail) }
}

export async function verifierCode(
  jeton: string,
  code: string,
  deps: { maintenant?: Date } = {},
): Promise<{ ok: true; lienId: string } | { ok: false; raison: 'LIEN' | 'CODE' | 'EPUISE' }> {
  const maintenant = deps.maintenant ?? new Date()
  const { etat, lienId } = await resoudreLien(jeton)
  if (etat !== 'ACTIF' || lienId === null) return { ok: false, raison: 'LIEN' }

  const lien = await prisma.lienClient.findUniqueOrThrow({ where: { id: lienId } })
  if (lien.codeEssais >= CODE_ESSAIS_MAX) return { ok: false, raison: 'EPUISE' }
  if (lien.codeEmpreinte === '' || lien.codeExpireAt === null || maintenant >= lien.codeExpireAt) {
    return { ok: false, raison: 'CODE' }
  }

  const attendu = Buffer.from(lien.codeEmpreinte, 'hex')
  const fourni = Buffer.from(empreinteCode(lien.id, code.trim(), secretClient()), 'hex')
  if (attendu.length !== fourni.length || !timingSafeEqual(attendu, fourni)) {
    const essais = lien.codeEssais + 1
    await prisma.lienClient.update({ where: { id: lien.id }, data: { codeEssais: essais } })
    await journal(lien.craId, 'signature.code.echoue', lien.numero)
    return { ok: false, raison: essais >= CODE_ESSAIS_MAX ? 'EPUISE' : 'CODE' }
  }

  // Usage unique : le code juste est effacé dès qu'il a servi.
  await prisma.lienClient.update({
    where: { id: lien.id },
    data: { codeEmpreinte: '', codeExpireAt: null, codeEssais: 0 },
  })
  await journal(lien.craId, 'signature.code.valide', lien.numero)
  return { ok: true, lienId: lien.id }
}

export interface VueClient {
  etat: EtatLien
  document: CraDocument | null
  statut: 'A_SIGNER' | 'SIGNE' | 'REFUSE' | 'EXPIRE'
  signeLe: Date | null
  refuseLe: Date | null
  motifRefus: string
  empreinte: string
  pdfSigneDisponible: boolean
  urlEmbarquee: string | null
}

const STATUTS: Record<string, VueClient['statut']> = {
  EN_ATTENTE: 'A_SIGNER',
  SIGNE: 'SIGNE',
  REFUSE: 'REFUSE',
  EXPIRE: 'EXPIRE',
}

async function lienEtDemande(lienId: string) {
  const lien = await prisma.lienClient.findUnique({ where: { id: lienId } })
  if (lien === null) return null
  const demande = await prisma.signatureRequest.findUnique({
    where: { craId: lien.craId },
    select: {
      numero: true, status: true, externalId: true, contenuFige: true, empreinte: true,
      motifRefus: true, completedAt: true, signataireNom: true, signataireEmail: true,
    },
  })
  if (demande === null) return null
  return { lien, demande }
}

/**
 * Ce que la page client affiche. **Ne lit que le contenu figé** — jamais une
 * saisie, jamais un réglage.
 */
export async function lireVueClient(
  lienId: string,
  deps: { connector?: SignatureConnector | null; maintenant?: Date } = {},
): Promise<VueClient> {
  const maintenant = deps.maintenant ?? new Date()
  const vide: VueClient = {
    etat: 'INCONNU', document: null, statut: 'A_SIGNER', signeLe: null, refuseLe: null,
    motifRefus: '', empreinte: '', pdfSigneDisponible: false, urlEmbarquee: null,
  }

  const lu = await lienEtDemande(lienId)
  if (lu === null) return vide
  const { lien, demande } = lu
  if (lien.numero < demande.numero) return { ...vide, etat: 'REMPLACE' }
  if (lien.revokedAt !== null || demande.status === 'ANNULE') return { ...vide, etat: 'RETIRE' }

  // Une consultation par heure au journal : assez pour le suivi, pas assez
  // pour qu'un client qui recharge sa page noie l'historique.
  if (lien.derniereConsultationAt === null || maintenant.getTime() - lien.derniereConsultationAt.getTime() >= HEURE_MS) {
    await prisma.lienClient.update({ where: { id: lien.id }, data: { derniereConsultationAt: maintenant } })
    await journal(lien.craId, 'signature.lien.ouvert', lien.numero)
  }

  const statut = STATUTS[demande.status] ?? 'A_SIGNER'
  const archive = await prisma.signatureRequest.count({ where: { craId: lien.craId, NOT: { signedPdf: null } } })

  let urlEmbarquee: string | null = null
  if (statut === 'A_SIGNER' && lien.jetonSignataire !== '') {
    const connector = deps.connector !== undefined ? deps.connector : await getSignatureConnector()
    if (connector !== null) {
      urlEmbarquee = connector.urlEmbarquee(lien.jetonSignataire, {
        nom: demande.signataireNom,
        email: demande.signataireEmail,
      })
    }
  }

  return {
    etat: 'ACTIF',
    document: lireContenu(demande.contenuFige),
    statut,
    signeLe: statut === 'SIGNE' ? demande.completedAt : null,
    refuseLe: statut === 'REFUSE' ? demande.completedAt : null,
    motifRefus: statut === 'REFUSE' ? demande.motifRefus : '',
    empreinte: demande.empreinte,
    pdfSigneDisponible: statut === 'SIGNE' && archive > 0,
    urlEmbarquee,
  }
}

/**
 * Appelée par la page quand le cadre annonce « signé » ou « refusé ».
 *
 * **Le message du navigateur ne décide de rien** : on redemande l'état au
 * prestataire, et seul ce qu'il confirme s'applique, par l'applicateur
 * unique. Un message forgé dans la console ne valide aucun mois.
 */
export async function confirmerDepuisPage(
  lienId: string,
  deps: { connector?: SignatureConnector | null; mailer?: Mailer | null } = {},
): Promise<void> {
  const lu = await lienEtDemande(lienId)
  if (lu === null) return
  const { lien, demande } = lu
  if (lien.numero !== demande.numero || lien.revokedAt !== null) return
  if (demande.status !== 'EN_ATTENTE' || demande.externalId === '') return

  const connector = deps.connector !== undefined ? deps.connector : await getSignatureConnector()
  if (connector === null) return

  let etat
  try {
    etat = await connector.status(demande.externalId)
  } catch {
    return // le webhook ou le balayage prendront le relais
  }

  await applySignatureStatus({
    craId: lien.craId,
    externalId: demande.externalId,
    statut: etat.statut,
    motifRefus: etat.motifRefus,
    connector,
    mailer: deps.mailer ?? null,
  })
}

/**
 * Le jeton Documenso a expiré : on le renouvelle et on le pose sur tous les
 * liens ouverts de l'envoi.
 */
export async function renouvelerDepuisPage(
  lienId: string,
  deps: { connector?: SignatureConnector | null } = {},
): Promise<void> {
  const lu = await lienEtDemande(lienId)
  if (lu === null) return
  const { lien, demande } = lu
  if (lien.numero !== demande.numero || lien.revokedAt !== null) return
  if (demande.status !== 'EN_ATTENTE' || demande.externalId === '') return

  const connector = deps.connector !== undefined ? deps.connector : await getSignatureConnector()
  if (connector === null) return
  try {
    const jeton = await connector.renouveler(demande.externalId)
    if (jeton === '') return
    await prisma.lienClient.updateMany({
      where: { craId: lien.craId, numero: lien.numero, revokedAt: null },
      data: { jetonSignataire: jeton },
    })
  } catch {
    // la page proposera d'ouvrir le document dans un nouvel onglet
  }
}

/** Le PDF signé, pour un lien de l'envoi en cours **et signé** ; sinon `null`. */
export async function pdfSigneDuLien(lienId: string): Promise<{ fileName: string; bytes: Uint8Array } | null> {
  const lien = await prisma.lienClient.findUnique({ where: { id: lienId } })
  if (lien === null || lien.revokedAt !== null) return null
  const demande = await prisma.signatureRequest.findUnique({
    where: { craId: lien.craId },
    select: { numero: true, status: true, signedPdf: true, cra: { select: { month: true, mission: { select: { label: true, client: { select: { name: true } } } } } } },
  })
  if (demande === null || demande.numero !== lien.numero || demande.status !== 'SIGNE' || demande.signedPdf == null) return null
  const mois = demande.cra.month.toISOString().slice(0, 7)
  return {
    fileName: nomFichierCra(demande.cra.mission.client.name, demande.cra.mission.label, mois).replace(/\.pdf$/, '-signe.pdf'),
    bytes: new Uint8Array(demande.signedPdf),
  }
}

/**
 * Un lien de plus pour l'envoi en cours, à transmettre à la main quand le
 * courriel n'est pas parti. Scopé : seul le propriétaire du CRA l'obtient.
 */
export async function nouveauLienManuel(
  userId: string,
  craId: string,
  origine: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  const cra = await prisma.cra.findFirst({ where: { id: craId, userId }, select: { id: true } })
  if (cra === null) return { ok: false }
  const demande = await prisma.signatureRequest.findUnique({
    where: { craId },
    select: { numero: true, status: true, origine: true },
  })
  if (demande === null || demande.status !== 'EN_ATTENTE' || demande.origine === '') return { ok: false }

  const existant = await prisma.lienClient.findFirst({
    where: { craId, numero: demande.numero, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { jetonSignataire: true },
  })
  // Jamais de lien sans jeton prestataire : il ouvrirait une page sans cadre.
  if (existant === null || existant.jetonSignataire === '') return { ok: false }
  const jeton = await prisma.$transaction((tx) =>
    creerLienClient(tx, { craId, numero: demande.numero, jetonSignataire: existant.jetonSignataire }),
  )
  const base = (origine !== '' ? origine : demande.origine).replace(/\/+$/, '')
  return { ok: true, url: `${base}/v/${jeton}` }
}
