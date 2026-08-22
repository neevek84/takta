/**
 * La règle de conversion d'une **ligne vendue** Dolibarr en engagement local —
 * qu'elle vienne d'une propale ou d'une commande.
 *
 * Pur : aucune base, aucun réseau, aucun réglage. C'est délibéré — voir plus
 * bas pourquoi le facteur de conversion d'une journée n'entre pas ici.
 *
 * L'engagement contractuel est porté par la **ligne** de prestation, jamais
 * par le document : une propale porte « Consultant ITSM 30 j TJM 800 » et
 * « Consultant ITSM Nuit 10 j TJM 1200 » sur deux lignes distinctes, et c'est
 * sur la bonne ligne que le consultant fait son CRA. Reprendre un total
 * effacerait le tarif de nuit — d'où une conversion ligne à ligne, et rien qui
 * additionne.
 *
 * **Une seule implémentation pour les deux documents.** La propale sert avant
 * signature, la commande après ; la règle de conversion, elle, est identique.
 * Deux copies finiraient par diverger sur l'arrondi, et c'est le nombre de
 * jours facturés qui en dépend.
 */

/** Ce qu'une ligne vendue devient localement, en entiers. */
export interface RepriseLigneVendue {
  /** jours vendus, en centièmes de jour */
  soldCentiemes: number
  /** prix unitaire, en centimes */
  tjmCents: number
}

/** Le document d'où vient la ligne — ne sert qu'à rédiger un refus lisible. */
export type DocumentVendeur = 'propale' | 'commande'

/**
 * Convertit une ligne vendue en jours vendus et TJM locaux.
 *
 * **Le facteur de conversion d'une journée (`minutesParJour`) n'intervient
 * pas.** Un document vend des jours ; `soldCentiemes` compte des centièmes de
 * jour, pas des minutes. Faire passer la quantité par le facteur courant
 * donnerait un engagement qui change tout seul le jour où le réglage change —
 * exactement ce que le gel du facteur interdit. Le facteur ne sert qu'à
 * convertir des **saisies**, et chacune fige le sien à l'écriture.
 */
export function reprendreLigneVendue(
  ligne: {
    /** quantité vendue, en jours */
    qty: number
    /** prix unitaire, en centimes */
    subpriceCents: number
  },
  document: DocumentVendeur = 'propale',
): RepriseLigneVendue {
  if (!Number.isFinite(ligne.qty) || ligne.qty < 0) {
    throw new Error(
      `Quantité « ${ligne.qty} » : une ligne de ${document} se reprend sur un nombre de jours positif.`,
    )
  }
  if (!Number.isInteger(ligne.subpriceCents) || ligne.subpriceCents < 0) {
    throw new Error(
      `Prix unitaire « ${ligne.subpriceCents} » : un entier de centimes positif est attendu.`,
    )
  }

  return {
    // Arrondi, jamais tronqué : 7,35 j vaut 734,999… en binaire, et `Math.trunc`
    // perdrait un centième de jour vendu à chaque reprise.
    soldCentiemes: Math.round(ligne.qty * 100),
    tjmCents: ligne.subpriceCents,
  }
}
