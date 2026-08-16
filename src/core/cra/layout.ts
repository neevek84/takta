import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  largeurApprox,
  type PdfLine,
  type PdfPage,
  type PdfText,
} from '../pdf/writer'
import { formatJours, libelleJour, type CraDocument } from './document'

export const MARGE = 40
/** Au-delà, les colonnes ne tiennent plus en largeur : on ouvre une page. */
export const LIGNES_PAR_PAGE = 5

const DROITE = A4_WIDTH_PT - MARGE // 555
const COLONNE_JOUR_X = MARGE
const COLONNE_X0 = MARGE + 100 // 140
const COLONNE_LARGEUR = 83

const Y_TITRE = A4_HEIGHT_PT - MARGE - 10 // 792
const Y_ENTETE = 770
const Y_FILET_ENTETE = 724
const Y_ENTETE_TABLE = 706
const Y_FILET_TABLE = 700
const Y_PREMIERE_LIGNE = 686
const PAS_LIGNE = 15.5
const Y_PIED = 32

function colonneX(index: number): number {
  return COLONNE_X0 + index * COLONNE_LARGEUR
}

/** Aligne une quantité sur le bord droit de sa colonne. */
function aDroite(texte: string, xColonne: number, size: number): number {
  return xColonne + COLONNE_LARGEUR - 6 - largeurApprox(texte, size)
}

function tronquer(texte: string, largeurMax: number, size: number): string {
  if (largeurApprox(texte, size) <= largeurMax) return texte
  let coupe = texte
  while (coupe.length > 1 && largeurApprox(`${coupe}…`, size) > largeurMax) {
    coupe = coupe.slice(0, -1)
  }
  return `${coupe.trimEnd()}…`
}

export function layoutCraDocument(doc: CraDocument): PdfPage[] {
  const paquets: CraDocument['lignes'][] = []
  for (let i = 0; i < doc.lignes.length; i += LIGNES_PAR_PAGE) {
    paquets.push(doc.lignes.slice(i, i + LIGNES_PAR_PAGE))
  }
  if (paquets.length === 0) paquets.push([])

  return paquets.map((paquet, index) =>
    composerPage(doc, paquet, index + 1, paquets.length, index === paquets.length - 1),
  )
}

function composerPage(
  doc: CraDocument,
  lignes: CraDocument['lignes'],
  numero: number,
  total: number,
  derniere: boolean,
): PdfPage {
  const texts: PdfText[] = []
  const lines: PdfLine[] = []

  // --- Entête -------------------------------------------------------------
  texts.push({ x: MARGE, y: Y_TITRE, size: 15, text: 'Compte rendu d’activité', bold: true })

  texts.push({ x: MARGE, y: Y_ENTETE, size: 10, text: doc.emetteur.nom, bold: true })
  ;[doc.emetteur.adresse, doc.emetteur.siret, doc.emetteur.email].forEach((valeur, i) => {
    if (valeur === '') return
    texts.push({ x: MARGE, y: Y_ENTETE - 12 - i * 11, size: 8.5, text: valeur })
  })

  const xDroite = 330
  texts.push({ x: xDroite, y: Y_ENTETE, size: 10, text: `Client : ${doc.clientNom}`, bold: true })
  texts.push({ x: xDroite, y: Y_ENTETE - 12, size: 8.5, text: `Mission : ${doc.missionLabel}` })
  texts.push({ x: xDroite, y: Y_ENTETE - 23, size: 8.5, text: `Période : ${doc.moisLibelle}` })

  lines.push({ x1: MARGE, y1: Y_FILET_ENTETE, x2: DROITE, y2: Y_FILET_ENTETE, thickness: 0.8 })

  // --- Entête du tableau ---------------------------------------------------
  texts.push({ x: COLONNE_JOUR_X, y: Y_ENTETE_TABLE, size: 8.5, text: 'Jour', bold: true })
  lignes.forEach((ligne, i) => {
    texts.push({
      x: colonneX(i) + 2,
      y: Y_ENTETE_TABLE,
      size: 8.5,
      text: tronquer(ligne.label, COLONNE_LARGEUR - 8, 8.5),
      bold: true,
    })
  })
  lines.push({ x1: MARGE, y1: Y_FILET_TABLE, x2: DROITE, y2: Y_FILET_TABLE, thickness: 0.5 })

  // --- Corps ---------------------------------------------------------------
  const parLigneEtJour = lignes.map(
    (ligne) => new Map(ligne.jours.map((j) => [j.date, j.centiemes])),
  )

  doc.joursDuMois.forEach((date, rang) => {
    const y = Y_PREMIERE_LIGNE - rang * PAS_LIGNE
    texts.push({ x: COLONNE_JOUR_X, y, size: 8, text: libelleJour(date) })

    parLigneEtJour.forEach((cellules, i) => {
      const centiemes = cellules.get(date)
      if (centiemes === undefined) return
      const valeur = formatJours(centiemes)
      texts.push({ x: aDroite(valeur, colonneX(i), 8), y, size: 8, text: valeur })
    })
  })

  const yFiletTotaux = Y_PREMIERE_LIGNE - doc.joursDuMois.length * PAS_LIGNE + 6
  lines.push({ x1: MARGE, y1: yFiletTotaux, x2: DROITE, y2: yFiletTotaux, thickness: 0.8 })

  const yTotaux = yFiletTotaux - 12
  texts.push({ x: COLONNE_JOUR_X, y: yTotaux, size: 8.5, text: 'Total', bold: true })
  lignes.forEach((ligne, i) => {
    const valeur = formatJours(ligne.totalCentiemes)
    texts.push({
      x: aDroite(valeur, colonneX(i), 8.5),
      y: yTotaux,
      size: 8.5,
      text: valeur,
      bold: true,
    })
  })

  if (lignes.length === 0) {
    texts.push({
      x: COLONNE_X0,
      y: Y_PREMIERE_LIGNE,
      size: 9,
      text: 'Aucun temps réalisé n’a été saisi sur ce mois.',
    })
  }

  // --- Pavé de signature, dernière page seulement ---------------------------
  // Un document qu'on peut signer deux fois est un document qui sera signé
  // deux fois.
  if (derniere) {
    const yMention = yTotaux - 22
    texts.push({
      x: MARGE,
      y: yMention,
      size: 9,
      text: `Total du mois : ${formatJours(doc.totalCentiemes)} jour(s)`,
      bold: true,
    })
    texts.push({
      x: MARGE,
      y: yMention - 26,
      size: 9,
      text: 'Bon pour accord — validation du client',
      bold: true,
    })
    texts.push({
      x: MARGE,
      y: yMention - 39,
      size: 8.5,
      text: `Signataire : ${doc.signataireNom}${doc.signataireEmail === '' ? '' : ` (${doc.signataireEmail})`}`,
    })
    texts.push({ x: MARGE, y: yMention - 51, size: 8.5, text: 'Date et signature :' })

    const cadreHaut = yMention - 20
    const cadreBas = Math.max(Y_PIED + 18, cadreHaut - 72)
    const cadreGauche = 330
    lines.push(
      { x1: cadreGauche, y1: cadreHaut, x2: DROITE, y2: cadreHaut, thickness: 0.5 },
      { x1: cadreGauche, y1: cadreBas, x2: DROITE, y2: cadreBas, thickness: 0.5 },
      { x1: cadreGauche, y1: cadreBas, x2: cadreGauche, y2: cadreHaut, thickness: 0.5 },
      { x1: DROITE, y1: cadreBas, x2: DROITE, y2: cadreHaut, thickness: 0.5 },
    )
  }

  // --- Pied de page --------------------------------------------------------
  texts.push({
    x: MARGE,
    y: Y_PIED,
    size: 7.5,
    text: 'Document attestant du temps passé — aucun montant n’y figure.',
  })
  const pagination = `Page ${numero} / ${total}`
  texts.push({
    x: DROITE - largeurApprox(pagination, 7.5),
    y: Y_PIED,
    size: 7.5,
    text: pagination,
  })

  return { texts, lines }
}
