import {
  A4_PAYSAGE_HEIGHT_PT,
  A4_PAYSAGE_WIDTH_PT,
  largeurApprox,
  type PdfLine,
  type PdfPage,
  type PdfRect,
  type PdfText,
} from '../pdf/writer'
import { THEME_ENCRE_CLAIR } from '../theme/tokens'
import { joursDuMois } from '../cra/document'
import { dateFr } from './periode'
import { joursLisibles, type PlanningDocument, type PlanningJour } from './document'

/**
 * La mise en page du planning : **A4 couché, deux mois par page**, en
 * calendrier — une case par jour, une étiquette par jour d'intervention.
 *
 * Le CRA aligne trente-et-un jours sur une bande, parce qu'il se lit en
 * quantités ; le planning se lit en semaines, comme un agenda mural. C'est
 * la demande d'origine : sur la bande, « on ne voit rien ».
 *
 * Coordonnées comptées **depuis le haut**, retournées une seule fois au
 * moment de poser l'objet, comme dans `core/cra/layout.ts`.
 */

const T = THEME_ENCRE_CLAIR

const LARGEUR = A4_PAYSAGE_WIDTH_PT
const HAUTEUR = A4_PAYSAGE_HEIGHT_PT
const MARGE = 34
const DROITE = LARGEUR - MARGE
const LARGEUR_UTILE = DROITE - MARGE

const Y_FILET_TITRE = 72
const Y_SYNTHESE = 82
const HAUTEUR_SYNTHESE = 30
const Y_GRILLE_PREMIERE = 126
const Y_GRILLE_SUIVANTES = 88
const Y_BAS_GRILLE = 545
const Y_FILET_PIED = 555
const Y_PIED = 569

const GOUTTIERE_MOIS = 22
const LARGEUR_MOIS = (LARGEUR_UTILE - GOUTTIERE_MOIS) / 2
const LARGEUR_CASE = LARGEUR_MOIS / 7
const SEMAINES = 6
const HAUTEUR_ETIQUETTE = 12

export const MOIS_PAR_PAGE = 2

const JOURS_SEMAINE = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
const MOIS_LONG = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]
const MOIS_COURT = [
  'JANV.', 'FÉVR.', 'MARS', 'AVR.', 'MAI', 'JUIN',
  'JUIL.', 'AOÛT', 'SEPT.', 'OCT.', 'NOV.', 'DÉC.',
]

const TIRET_DEMI: readonly [number, number] = [2, 1.5]

class Feuille {
  readonly texts: PdfText[] = []
  readonly lines: PdfLine[] = []
  readonly rects: PdfRect[] = []

  texte(
    x: number,
    yHaut: number,
    text: string,
    options: { size?: number; bold?: boolean; color?: string } = {},
  ): void {
    if (text === '') return
    this.texts.push({
      x,
      y: HAUTEUR - yHaut,
      size: options.size ?? 8,
      text,
      ...(options.bold === true ? { bold: true } : {}),
      color: options.color ?? T.ink,
    })
  }

  /** Aligné à droite sur `xDroite`. */
  texteADroite(
    xDroite: number,
    yHaut: number,
    text: string,
    options: { size?: number; bold?: boolean; color?: string } = {},
  ): void {
    this.texte(xDroite - largeurApprox(text, options.size ?? 8), yHaut, text, options)
  }

  filet(x1: number, yHaut: number, x2: number, epaisseur: number, couleur: string): void {
    this.lines.push({ x1, y1: HAUTEUR - yHaut, x2, y2: HAUTEUR - yHaut, thickness: epaisseur, color: couleur })
  }

  pave(
    x: number,
    yHaut: number,
    w: number,
    h: number,
    options: Omit<PdfRect, 'x' | 'y' | 'w' | 'h'>,
  ): void {
    this.rects.push({ x, y: HAUTEUR - yHaut - h, w, h, ...options })
  }

  page(): PdfPage {
    return {
      texts: this.texts,
      lines: this.lines,
      rects: this.rects,
      width: LARGEUR,
      height: HAUTEUR,
    }
  }
}

/** Coupe un libellé pour qu'il tienne dans `largeur` points, avec « … ». */
function tronquer(texte: string, size: number, largeur: number): string {
  if (largeurApprox(texte, size) <= largeur) return texte
  let court = texte
  while (court.length > 1 && largeurApprox(`${court}…`, size) > largeur) court = court.slice(0, -1)
  return `${court.trimEnd()}…`
}

function libelleEtiquette(jour: PlanningJour): { texte: string; plein: boolean } {
  if (jour.centiemes === 100) return { texte: 'Journée', plein: true }
  if (jour.centiemes === 50) {
    if (jour.moment === 'MATIN') return { texte: '½ matin', plein: false }
    if (jour.moment === 'APRES_MIDI') return { texte: '½ après-midi', plein: false }
    return { texte: '½ journée', plein: false }
  }
  return { texte: `${joursLisibles(jour.centiemes)} j`, plein: jour.centiemes > 100 }
}

function entete(f: Feuille, doc: PlanningDocument, numero: number, total: number): void {
  f.texte(MARGE, 40, 'PLANNING D’INTERVENTION', { size: 7.5, bold: true, color: T.accentDark })

  const tailleClient = 17
  f.texte(MARGE, 62, doc.clientNom, { size: tailleClient, bold: true })
  // `largeurApprox` sous-estime un peu le gras : la marge le rattrape.
  const xSousTitre = MARGE + largeurApprox(doc.clientNom, tailleClient) * 1.08 + 8
  const sousTitre =
    doc.prestationLabel === ''
      ? `Mission ${doc.missionLabel}`
      : `Mission ${doc.missionLabel} — ${doc.prestationLabel}`
  f.texte(xSousTitre, 62, tronquer(sousTitre, 11, 560 - xSousTitre), { size: 11, color: T.muted })

  f.texteADroite(
    DROITE,
    50,
    `Du ${dateFr(doc.periode.du)} au ${dateFr(doc.periode.au)}`,
    { size: 9.5, bold: true },
  )
  f.texteADroite(DROITE, 63, `Page ${numero}/${total}`, { size: 8, color: T.muted })
  f.filet(MARGE, Y_FILET_TITRE, DROITE, 1.2, T.ink)
}

function synthese(f: Feuille, doc: PlanningDocument): void {
  const cases = [
    ...doc.mois.map((m) => {
      const [annee, numero] = m.mois.split('-').map(Number) as [number, number]
      return { libelle: `${MOIS_COURT[numero - 1]} ${annee}`, valeur: m.centiemes, total: false }
    }),
    { libelle: 'TOTAL', valeur: doc.centiemes, total: true },
  ]
  const gouttiere = 5
  const largeur = (LARGEUR_UTILE - gouttiere * (cases.length - 1)) / cases.length
  cases.forEach((c, i) => {
    const x = MARGE + i * (largeur + gouttiere)
    f.pave(x, Y_SYNTHESE, largeur, HAUTEUR_SYNTHESE, {
      radius: 3,
      thickness: 0.6,
      stroke: c.total ? T.ink : T.rule,
      ...(c.total ? { fill: T.ink } : {}),
    })
    f.texte(x + 6, Y_SYNTHESE + 11, tronquer(c.libelle, 6.5, largeur - 10), {
      size: 6.5,
      color: c.total ? T.onDark : T.muted,
    })
    f.texte(x + 6, Y_SYNTHESE + 25, `${joursLisibles(c.valeur)} j`, {
      size: 11,
      bold: true,
      color: c.total ? T.onDark : T.ink,
    })
  })
}

function mois(f: Feuille, doc: PlanningDocument, mois: string, x: number, yHaut: number): void {
  const [annee, numero] = mois.split('-').map(Number) as [number, number]
  const total = doc.mois.find((m) => m.mois === mois)?.centiemes ?? 0

  f.texte(x, yHaut + 12, MOIS_LONG[numero - 1] ?? '', { size: 13, bold: true })
  f.texte(x + largeurApprox(MOIS_LONG[numero - 1] ?? '', 13) * 1.08 + 5, yHaut + 12, String(annee), {
    size: 13,
    color: T.muted,
  })
  f.texteADroite(x + LARGEUR_MOIS, yHaut + 12, `${joursLisibles(total)} j`, {
    size: 9.5,
    bold: true,
    color: T.accentDark,
  })

  JOURS_SEMAINE.forEach((j, i) => {
    f.texte(x + i * LARGEUR_CASE + 3, yHaut + 27, j, { size: 6.5, bold: true, color: T.muted })
  })

  const yCases = yHaut + 32
  const hauteurCase = (Y_BAS_GRILLE - yCases) / SEMAINES
  const jours = joursDuMois(mois)
  // Lundi = 0 : la semaine du planning commence le lundi, comme un agenda.
  const decalage = (new Date(`${jours[0]}T00:00:00.000Z`).getUTCDay() + 6) % 7

  jours.forEach((date, index) => {
    const position = decalage + index
    const colonne = position % 7
    const semaine = Math.floor(position / 7)
    const cx = x + colonne * LARGEUR_CASE
    const cy = yCases + semaine * hauteurCase

    const dansLaPeriode = date >= doc.periode.du && date <= doc.periode.au
    const ferie = doc.feries[date]
    const weekEnd = colonne >= 5
    const fond = ferie !== undefined ? T.warning : weekEnd ? T.off : T.surface

    f.pave(cx, cy, LARGEUR_CASE, hauteurCase, { fill: fond, stroke: T.rule, thickness: 0.5 })
    f.texte(cx + 4, cy + 11, String(Number(date.slice(8, 10))), {
      size: 8.5,
      bold: dansLaPeriode && !weekEnd,
      color: dansLaPeriode ? (weekEnd ? T.muted : T.ink) : T.rule,
    })
    if (ferie !== undefined) {
      f.texte(cx + 4, cy + 19, tronquer(ferie, 5.5, LARGEUR_CASE - 7), {
        size: 5.5,
        color: T.warningInk,
      })
    }

    const jour = dansLaPeriode ? doc.jours[date] : undefined
    if (jour === undefined) return
    const { texte, plein } = libelleEtiquette(jour)
    const yEtiquette = cy + hauteurCase - 3 - HAUTEUR_ETIQUETTE
    f.pave(cx + 3, yEtiquette, LARGEUR_CASE - 6, HAUTEUR_ETIQUETTE, {
      radius: 2,
      ...(plein
        ? { fill: T.accentDark }
        : { fill: T.page, stroke: T.accentDark, thickness: 0.6, dash: TIRET_DEMI }),
    })
    f.texte(cx + 6, yEtiquette + 8.5, tronquer(texte, 6.5, LARGEUR_CASE - 12), {
      size: 6.5,
      bold: true,
      color: plein ? T.surface : T.link,
    })
  })
}

function pied(f: Feuille, doc: PlanningDocument): void {
  f.filet(MARGE, Y_FILET_PIED, DROITE, 0.5, T.rule)
  const legende: Array<{ libelle: string; options: Omit<PdfRect, 'x' | 'y' | 'w' | 'h'> }> = [
    { libelle: 'Journée d’intervention', options: { fill: T.accentDark } },
    {
      libelle: 'Demi-journée',
      options: { fill: T.page, stroke: T.accentDark, thickness: 0.6, dash: TIRET_DEMI },
    },
    { libelle: 'Jour férié', options: { fill: T.warning, stroke: T.rule, thickness: 0.5 } },
    { libelle: 'Week-end', options: { fill: T.off, stroke: T.rule, thickness: 0.5 } },
  ]
  let x = MARGE
  for (const l of legende) {
    f.pave(x, Y_PIED - 6.5, 10, 7, { radius: 1.5, ...l.options })
    f.texte(x + 14, Y_PIED, l.libelle, { size: 7, color: T.muted })
    x += 14 + largeurApprox(l.libelle, 7) + 16
  }
  f.texteADroite(
    DROITE,
    Y_PIED,
    `Planning prévisionnel, ajustable d’un commun accord · Édité le ${dateFr(doc.editeLe)}`,
    { size: 7, color: T.muted },
  )
}

export function layoutPlanningDocument(doc: PlanningDocument): PdfPage[] {
  const groupes: string[][] = []
  for (let i = 0; i < doc.mois.length; i += MOIS_PAR_PAGE) {
    groupes.push(doc.mois.slice(i, i + MOIS_PAR_PAGE).map((m) => m.mois))
  }

  return groupes.map((groupe, index) => {
    const f = new Feuille()
    entete(f, doc, index + 1, groupes.length)
    if (index === 0) synthese(f, doc)
    const yGrille = index === 0 ? Y_GRILLE_PREMIERE : Y_GRILLE_SUIVANTES
    groupe.forEach((m, colonne) => {
      mois(f, doc, m, MARGE + colonne * (LARGEUR_MOIS + GOUTTIERE_MOIS), yGrille)
    })
    pied(f, doc)
    return f.page()
  })
}
