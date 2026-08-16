import { centiemesParFacteur } from '../time/units'
import type { MinutesAuFacteur } from '../time/units'
import type { Slot } from '../time/slots'
import { momentDeJournee } from './slot-labels'
import type { MomentDeJournee } from './slot-labels'
import type { CellState } from './cycle'

/**
 * Le dessin d'une case, indépendamment de sa teinte.
 *
 * **La quantité se lit à la forme, pas au chiffre.** C'est le cœur du lot 1f :
 * une case remplie n'affichait qu'un nombre, ce qui est juste et illisible sur
 * un mois entier. Le chiffre reste — une durée libre de trois heures ne se
 * déduit d'aucun aplat —, mais il ne porte plus seul la lecture.
 *
 * Cette fonction est pure et sans DOM : c'est ce qui permet de vérifier que
 * les états se distinguent **sans la couleur** sans monter une seule case à
 * l'écran (`signatureDeForme`).
 */
export type Forme =
  | { kind: 'AUCUNE' }
  | { kind: 'PLEINE' }
  /** moitié séparée par une diagonale montant de bas-gauche à haut-droite */
  | { kind: 'MOITIE'; moment: MomentDeJournee }
  /** aplat partiel, ancré en bas ; `fraction` entre 0 exclu et 1 inclus */
  | { kind: 'PARTIELLE'; fraction: number }

/** Proportion nominale d'un créneau sans moitié de journée identifiable. */
const DEMI = 0.5

function partielle(fraction: number): Forme {
  // Arrondi au centième : c'est l'unité de la journée dans tout le domaine, et
  // une hauteur au millième de case ne se voit pas.
  const borne = Math.min(1, Math.round(fraction * 100) / 100)
  return borne <= 0 ? { kind: 'AUCUNE' } : { kind: 'PARTIELLE', fraction: borne }
}

/**
 * La forme d'une case, à partir de son état et de ses saisies.
 *
 * Les saisies viennent **une à une**, chacune avec le facteur de conversion
 * figé à son écriture : `centiemesParFacteur` les convertit à facteur
 * constant. Convertir la somme de leurs minutes sous le facteur courant de la
 * prestation est l'erreur la plus répétée du projet, et elle donnerait ici une
 * hauteur d'aplat fausse — 240 min à 480/jour plus 240 min à 420/jour valent
 * 1,07 journée, pas 1.
 */
export function formeDeLaCase(
  etat: CellState,
  saisies: readonly MinutesAuFacteur[],
  slots: readonly Slot[],
): Forme {
  switch (etat.kind) {
    case 'VIDE':
      return { kind: 'AUCUNE' }
    case 'JOURNEE':
      return { kind: 'PLEINE' }
    case 'DEMI': {
      const slot = slots.find((s) => s.id === etat.slotId)
      const moment = slot === undefined ? null : momentDeJournee(slot)
      // Ni au-dessus ni en dessous de la diagonale : un créneau qui franchit
      // minuit se dessine à sa proportion, et son libellé dit lequel c'est.
      if (moment === null) return partielle((slot?.centiemes ?? DEMI * 100) / 100)
      return { kind: 'MOITIE', moment }
    }
    case 'LIBRE':
      return partielle(centiemesParFacteur(saisies) / 100)
  }
}

/**
 * La forme, réduite à ce qui se voit en vision monochrome.
 *
 * Deux états qui partageraient cette signature seraient indistinguables sans
 * la couleur — c'est la règle du projet, et c'est ce qu'un test vérifie.
 * La proportion n'y entre pas : deux durées libres différentes se départagent
 * par leur chiffre, qui reste affiché.
 */
export function signatureDeForme(forme: Forme): string {
  return forme.kind === 'MOITIE' ? `MOITIE-${forme.moment}` : forme.kind
}
