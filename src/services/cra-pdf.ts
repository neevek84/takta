import { prisma } from '@/db/client'
import { renderPdf } from '@/core/pdf/writer'
import { buildCraDocument, type CraDocument } from '@/core/cra/document'
import { layoutCraDocument } from '@/core/cra/layout'
import type { TimeEntryKind } from '@/core/types'
import { readSettingsRow } from './settings'

export interface CraPdf {
  fileName: string
  bytes: Uint8Array
  /** le modèle qui a servi à composer le fichier, utile aux appelants et aux tests */
  document: CraDocument
}

export interface CraPdfTelechargement {
  fileName: string
  bytes: Uint8Array
  /** true = PDF signé servi tel quel, jamais recomposé */
  archive: boolean
}

/**
 * Retire accents, espaces, guillemets et séparateurs de chemin : ce nom part
 * dans un en-tête HTTP `Content-Disposition`, où un guillemet refermerait la
 * valeur et laisserait un libellé client piloter l'en-tête.
 */
export function nomFichierCra(clientNom: string, missionLabel: string, mois: string): string {
  const morceau = (brut: string): string =>
    brut
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  return `CRA-${morceau(clientNom)}-${morceau(missionLabel)}-${mois}.pdf`
}

/**
 * Le mois d'un CRA, en 'YYYY-MM', **validé**.
 *
 * `libelleMois` et `joursDuMois` (noyau) ne valident pas leur entrée : un mois
 * hors calendrier y produirait « undefined NaN » et un tableau de jours vide,
 * c'est-à-dire un document silencieusement faux, destiné à être signé. La
 * validation a sa place ici, à la frontière qui les appelle, et pas dans le
 * noyau — c'est là que la donnée entre.
 *
 * Le cas n'est pas théorique, et les deux branches sont atteignables selon la
 * base : un millésime à cinq chiffres écrit par un script de reprise rend
 * `+012026-06-01…` sur Postgres — dont les sept premiers caractères ne sont
 * plus un mois — et une date illisible côté SQLite, où le pilote rend une
 * `Invalid Date` dont `toISOString` ne ferait qu'une exception opaque.
 */
function moisDuCra(month: Date): string {
  if (Number.isNaN(month.getTime())) {
    throw new Error('Mois de CRA invalide : la date du mois est illisible.')
  }

  const mois =
    `${String(month.getUTCFullYear()).padStart(4, '0')}` +
    `-${String(month.getUTCMonth() + 1).padStart(2, '0')}`

  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(mois)) {
    throw new Error(`Mois de CRA invalide : ${mois}.`)
  }
  return mois
}

function bornesDuMois(mois: string): { start: Date; end: Date } {
  const [annee, numero] = mois.split('-').map(Number) as [number, number]
  return {
    start: new Date(Date.UTC(annee, numero - 1, 1)),
    end: new Date(Date.UTC(annee, numero, 1)),
  }
}

interface ContexteCra {
  craId: string
  missionId: string
  missionLabel: string
  clientNom: string
  /** 'YYYY-MM' */
  mois: string
  signataireNom: string
  signataireEmail: string
  fileName: string
}

/**
 * Charge le contexte d'un CRA en le scopant sur son propriétaire. Le
 * `findFirstOrThrow` sur `{ id, userId }` est la garantie qu'aucun appelant ne
 * peut télécharger le CRA d'un autre en devinant un identifiant.
 */
async function chargerContexte(userId: string, craId: string): Promise<ContexteCra> {
  const cra = await prisma.cra.findFirstOrThrow({
    where: { id: craId, userId },
    include: { mission: { include: { client: true } } },
  })

  const mois = moisDuCra(cra.month)
  return {
    craId: cra.id,
    missionId: cra.missionId,
    missionLabel: cra.mission.label,
    clientNom: cra.mission.client.name,
    mois,
    signataireNom: cra.mission.signataireNom,
    signataireEmail: cra.mission.signataireEmail,
    fileName: nomFichierCra(cra.mission.client.name, cra.mission.label, mois),
  }
}

export async function buildCraPdf(userId: string, craId: string): Promise<CraPdf> {
  const contexte = await chargerContexte(userId, craId)
  // `readSettingsRow` est le seul endroit du dépôt qui porte les valeurs de
  // création du singleton : y passer garantit la ligne avant de la lire.
  const settings = await readSettingsRow()

  // Seules les prestations réellement affectées à l'utilisateur : une mission
  // partagée ne fait pas fuiter les lignes des autres consultants.
  //
  // Les lignes archivées ne sont **pas** exclues : une prestation archivée en
  // cours de mois a bien été servie, et l'écarter ferait disparaître du CRA du
  // temps réellement réalisé. Une ligne sans aucune cellule ne s'imprime de
  // toute façon pas (`buildCraDocument` la saute).
  const lignes = await prisma.missionLine.findMany({
    where: { missionId: contexte.missionId, assignments: { some: { userId } } },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    select: { id: true, label: true },
  })

  const { start, end } = bornesDuMois(contexte.mois)
  const saisies = await prisma.timeEntry.findMany({
    where: { userId, lineId: { in: lignes.map((l) => l.id) }, date: { gte: start, lt: end } },
    orderBy: { date: 'asc' },
    select: { lineId: true, date: true, minutes: true, minutesParJour: true, kind: true },
  })

  const document = buildCraDocument({
    emetteur: {
      nom: settings.emetteurNom,
      adresse: settings.emetteurAdresse,
      siret: settings.emetteurSiret,
      email: settings.emetteurEmail,
    },
    clientNom: contexte.clientNom,
    missionLabel: contexte.missionLabel,
    mois: contexte.mois,
    signataireNom: contexte.signataireNom,
    signataireEmail: contexte.signataireEmail,
    lignes,
    // Chaque saisie part avec **son** facteur figé à l'écriture. Reconvertir
    // ici depuis le réglage courant ferait changer un CRA validé sans qu'aucune
    // donnée n'ait bougé : le gel se casse en lecture, jamais en écriture.
    entries: saisies.map((s) => ({
      lineId: s.lineId,
      date: s.date.toISOString().slice(0, 10),
      minutes: s.minutes,
      minutesParJour: s.minutesParJour,
      kind: s.kind as TimeEntryKind,
    })),
  })

  return {
    fileName: contexte.fileName,
    bytes: renderPdf(layoutCraDocument(document)),
    document,
  }
}

/**
 * Le document à servir : l'archive signée si elle existe, la regénération
 * sinon.
 *
 * **Un PDF signé ne se regénère jamais.** Le document que le client a signé
 * et le document que l'application recomposerait aujourd'hui sont deux objets
 * distincts ; seul le premier engage qui que ce soit.
 */
export async function getCraPdfForDownload(
  userId: string,
  craId: string,
): Promise<CraPdfTelechargement> {
  const contexte = await chargerContexte(userId, craId)

  const demande = await prisma.signatureRequest.findUnique({
    where: { craId: contexte.craId },
    select: { signedPdf: true },
  })

  if (demande?.signedPdf != null) {
    return {
      fileName: contexte.fileName.replace(/\.pdf$/, '-signe.pdf'),
      bytes: new Uint8Array(demande.signedPdf),
      archive: true,
    }
  }

  const { fileName, bytes } = await buildCraPdf(userId, craId)
  return { fileName, bytes, archive: false }
}
