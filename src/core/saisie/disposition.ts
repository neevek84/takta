import { signatureDeForme } from './forme'
import type { Forme } from './forme'

/** Ce qu'une prestation dessine sur un jour, avant d'avoir sa place dans la case. */
export interface AplatDuJour {
  lineId: string
  forme: Forme
  /** la journée de cette prestation est prévisionnelle — dite par le tireté */
  previsionnel: boolean
}

/** Un aplat et sa place : la bande verticale qu'il occupe dans la case. */
export interface AplatDispose extends AplatDuJour {
  /** rang de la bande, de gauche à droite, à partir de 0 */
  bande: number
  /** nombre de bandes égales de la case ; 1 = toute la largeur */
  bandes: number
}

/**
 * Où chaque prestation du jour pose son aplat.
 *
 * La case se lit en capture d'écran : le client qui a plusieurs commandes doit
 * voir d'un coup d'œil si le consultant est là, et une pastille de texte ne le
 * lui dit pas. Chaque prestation dessine donc sa forme — `formeDeLaCase`, la
 * même règle que la prestation saisie —, et cette fonction ne décide que de la
 * **place** : jamais deux aplats l'un sur l'autre.
 *
 * Un matin et un après-midi se tiennent déjà de part et d'autre de la
 * diagonale : ils partagent la case entière, c'est la lecture la plus juste de
 * la journée. Tout autre mélange se recouvrirait — deux journées, deux matins,
 * une durée partielle — et la case se partage alors en bandes verticales
 * égales, une par prestation, chacune gardant sa forme dans la sienne.
 *
 * L'ordre reçu est l'ordre des bandes : l'appelant y met la prestation saisie
 * en tête, puis les autres dans l'ordre des prestations, pour qu'une même
 * prestation reste du même côté d'un jour à l'autre.
 */
export function disposerAplats(aplats: readonly AplatDuJour[]): AplatDispose[] {
  const visibles = aplats.filter((a) => a.forme.kind !== 'AUCUNE')

  const signatures = visibles.map((a) => signatureDeForme(a.forme)).sort()
  const matinEtApresMidi =
    signatures.length === 2 && signatures[0] === 'MOITIE-AM' && signatures[1] === 'MOITIE-PM'

  if (visibles.length <= 1 || matinEtApresMidi) {
    return visibles.map((a) => ({ ...a, bande: 0, bandes: 1 }))
  }
  return visibles.map((a, i) => ({ ...a, bande: i, bandes: visibles.length }))
}
