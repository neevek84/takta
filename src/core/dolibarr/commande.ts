/**
 * Ce qu'une commande client devient quand elle donne naissance à un projet
 * Dolibarr — **la nomenclature, et rien d'autre**.
 *
 * Pur : aucune base, aucun réseau. C'est ici que se décide ce que le porteur,
 * son client et sa facture liront.
 *
 * **Le problème que ce module ferme.** Le projet Dolibarr n'a pas de champ
 * « référence client » : il porte `ref` (auto, `PJ…`), `title`, `ref_ext` et
 * une description. La commande, elle, porte `ref_client` — la référence du bon
 * de commande du client, celle qu'il exige de retrouver sur sa facture. Si
 * personne ne la recopie explicitement, elle s'arrête à la commande.
 *
 * Deux endroits, complémentaires et pas redondants : `ref_ext` la porte pour
 * les machines et survit à un renommage du projet ; le titre la porte pour les
 * humains, en tête, là où une liste de projets la laisse voir sans l'ouvrir.
 */

/** Ce que la colonne `title` d'un projet Dolibarr accepte. */
export const LONGUEUR_MAX_TITRE = 255

/** Sépare la référence du libellé. Le tiret cadratin, comme partout ailleurs. */
const SEPARATEUR = ' — '

/**
 * Replie tout blanc — espaces, tabulations, sauts de ligne — en un espace
 * simple. Dolibarr laisse passer des libellés multilignes, et un titre qui
 * saute une ligne casse toutes les listes qui l'affichent.
 */
function replier(valeur: string): string {
  return valeur.replace(/\s+/g, ' ').trim()
}

/**
 * Le titre du projet créé depuis une commande.
 *
 * Ordre imposé : la référence client d'abord, parce que c'est elle qu'on
 * cherche. À défaut, la référence de la commande — jamais un titre vide, et
 * jamais un titre qui commencerait par un libellé quelconque sans rien pour
 * l'identifier.
 */
export function titreProjetDepuisCommande(commande: {
  /** `ref_client` de la commande : la référence du BDC du client, souvent vide */
  refClient: string
  /** `ref` de la commande, du genre `CO2608-0042` */
  ref: string
  /** libellé ou objet de la commande, souvent vide lui aussi */
  label: string
}): string {
  const ref = replier(commande.ref)
  if (ref === '') {
    throw new Error('Une commande sans référence ne peut pas nommer un projet.')
  }

  const refClient = replier(commande.refClient)
  const label = replier(commande.label)

  const tete = refClient === '' ? ref : refClient
  // Quand la référence client tient la tête, la référence de la commande prend
  // la place du libellé absent : sans elle, le titre ne dirait pas de quelle
  // commande le projet est né.
  const queue = label !== '' ? label : refClient === '' ? '' : ref

  const titre = queue === '' ? tete : `${tete}${SEPARATEUR}${queue}`
  if (titre.length <= LONGUEUR_MAX_TITRE) return titre

  // Tronqué par la queue : c'est la tête qui identifie. `trimEnd` évite de
  // laisser un titre finir sur un espace ou sur un séparateur pendant.
  return titre.slice(0, LONGUEUR_MAX_TITRE).trimEnd()
}

/**
 * La référence externe posée sur le projet — la référence client, nue.
 *
 * Vide quand la commande n'en porte aucune : inventer une valeur ferait passer
 * pour un report ce qui n'en est pas un, et un rapprochement automatique s'y
 * appuierait plus tard.
 */
export function referenceExterneCommande(commande: { refClient: string }): string {
  return replier(commande.refClient)
}
