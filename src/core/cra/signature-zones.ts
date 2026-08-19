/**
 * Où signer, dit à une machine.
 *
 * Pur : aucune base, aucun réseau.
 *
 * **Le manque que ce module comble.** Le pavé « Bon pour accord » était un
 * dessin : un cadre, deux intitulés, rien qu'un outil de signature puisse
 * trouver. Le connecteur Documenso envoyait donc le PDF **sans aucun champ**,
 * et il fallait les poser à la main dans son interface, sur chaque CRA, tous
 * les mois.
 *
 * Deux façons de retrouver un champ, et le document porte les deux :
 *
 * - **une ancre de texte** invisible, posée à l'emplacement exact du champ.
 *   C'est ce que cherchent les outils à ancres (DocuSign, SignWell,
 *   PandaDoc…), et c'est visible d'une simple extraction de texte ;
 * - **des coordonnées**, rendues par ce module, pour les outils qui placent
 *   les champs par position — Documenso en fait partie.
 *
 * Les deux viennent de la **même** source : la position réellement occupée par
 * l'ancre dans la page composée. Recalculer la géométrie de son côté aurait
 * créé deux vérités qui finissent par diverger d'un demi-centimètre, c'est-à-
 * dire par poser la signature à côté du cadre.
 */
import { A4_HEIGHT_PT, A4_WIDTH_PT, type PdfPage } from '../pdf/writer'

/** L'ancre du champ de signature. Ne jamais la changer sans migrer les gabarits. */
export const ANCRE_SIGNATURE = '[[cra:signature]]'

/** L'ancre du champ de date. */
export const ANCRE_DATE = '[[cra:date]]'

/**
 * Ce qu'un champ occupe, en points PDF, **origine en bas à gauche** — la
 * convention du format, et celle qu'attendent les outils qui parlent en
 * points.
 */
export interface ZoneChamp {
  /** ancre posée à cet endroit, pour les outils qui cherchent du texte */
  ancre: string
  /** numéro de page, à partir de 1 */
  page: number
  x: number
  y: number
  largeur: number
  hauteur: number
  /** dimensions de la page qui le porte, en points */
  pageLargeur: number
  pageHauteur: number
}

export interface ZonesSignature {
  signature: ZoneChamp
  date: ZoneChamp
}

/** Les dimensions des deux champs, en points. */
export const TAILLE_CHAMP_SIGNATURE = { largeur: 148, hauteur: 34 } as const
export const TAILLE_CHAMP_DATE = { largeur: 70, hauteur: 16 } as const

function trouver(
  pages: ReadonlyArray<PdfPage>,
  ancre: string,
  taille: { largeur: number; hauteur: number },
): ZoneChamp {
  for (const [i, page] of pages.entries()) {
    const pose = page.texts.find((t) => t.text === ancre)
    if (pose !== undefined) {
      return {
        ancre,
        page: i + 1,
        x: pose.x,
        y: pose.y,
        largeur: taille.largeur,
        hauteur: taille.hauteur,
        pageLargeur: page.width ?? A4_WIDTH_PT,
        pageHauteur: page.height ?? A4_HEIGHT_PT,
      }
    }
  }

  // Non trouvée : lever, jamais rendre une zone inventée. Un champ posé au
  // hasard fait signer à côté du cadre, et personne ne s'en aperçoit avant que
  // le client ait signé.
  throw new Error(`L'ancre ${ancre} n'a été posée sur aucune page du document.`)
}

/**
 * Les deux zones du pavé de signature, retrouvées dans les pages composées.
 *
 * Lève si une ancre manque — c'est un défaut de composition, pas un cas à
 * traiter en silence.
 */
export function zonesSignature(pages: ReadonlyArray<PdfPage>): ZonesSignature {
  return {
    signature: trouver(pages, ANCRE_SIGNATURE, TAILLE_CHAMP_SIGNATURE),
    date: trouver(pages, ANCRE_DATE, TAILLE_CHAMP_DATE),
  }
}
