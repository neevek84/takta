/**
 * La traduction d'un champ vers les coordonnées de Documenso.
 *
 * Pur : aucune dépendance, aucun réseau. C'est délibéré — la conversion est la
 * seule partie de l'intégration qu'on puisse prouver sans instance.
 *
 * **Deux conventions qui s'opposent, et c'est tout le sujet.** Le PDF compte
 * en points depuis le **bas** de la page. Documenso compte en **pourcentages**
 * depuis le **haut**. Une conversion oubliée place la signature à la même
 * distance de l'autre bord — sur un CRA en paysage, c'est-à-dire ailleurs.
 */
import type { SignatureChamp } from './connector'

/** Un champ tel que l'API v2 de Documenso l'attend à la création d'une enveloppe. */
export interface DocumensoField {
  type: 'SIGNATURE' | 'DATE'
  /** l'index du fichier téléversé qui porte le champ — il n'y en a qu'un */
  identifier: 0
  /** à partir de 1 */
  page: number
  /** pourcentages de la page, origine en **haut** à gauche */
  positionX: number
  positionY: number
  width: number
  height: number
}

/** Arrondi au centième de pourcent : au-delà, c'est du bruit. */
function pourcent(part: number, tout: number): number {
  if (tout <= 0) {
    throw new Error('Une page sans dimension ne peut pas porter de champ.')
  }
  return Math.round((part / tout) * 10_000) / 100
}

export function versDocumensoField(champ: SignatureChamp): DocumensoField {
  return {
    type: champ.nature,
    identifier: 0,
    page: champ.page,
    positionX: pourcent(champ.x, champ.pageLargeur),
    // `y` désigne le **bas** du champ ; Documenso attend son **haut**, compté
    // depuis le haut de la page. Les deux inversions se composent.
    positionY: pourcent(champ.pageHauteur - (champ.y + champ.hauteur), champ.pageHauteur),
    width: pourcent(champ.largeur, champ.pageLargeur),
    height: pourcent(champ.hauteur, champ.pageHauteur),
  }
}
