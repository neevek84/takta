/**
 * Le texte lisible caché dans un fragment HTML.
 *
 * **Pourquoi il faut le faire.** Les descriptions de Dolibarr passent par un
 * éditeur riche : ce que son API rend n'est pas du texte, c'est du HTML. Repris
 * tel quel, un libellé de prestation arrive à l'écran en
 * `Déploiement FreshService.&nbsp;` — et il repart tel quel dans le PDF envoyé
 * au client, dans le nom de la tâche, dans le CRA. Constaté le 22 août 2026.
 *
 * Ce n'est pas un assainissement de sécurité : rien ici n'est rendu en HTML.
 * C'est une conversion, et elle vise la **lisibilité**.
 */

/** Ce qui sépare deux phrases dans la mise en forme : remplacé par une espace. */
const COUPURES = /<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?\s*>/gi

/** Les entités nommées qu'un éditeur riche produit réellement. */
const ENTITES: Readonly<Record<string, string>> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  ugrave: 'ù',
  ocirc: 'ô',
  icirc: 'î',
  ecirc: 'ê',
  acirc: 'â',
  euro: '€',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  ndash: '–',
  mdash: '—',
}

function entite(nom: string): string | null {
  const connue = ENTITES[nom.toLowerCase()]
  if (connue !== undefined) return connue

  // Numériques, en décimal comme en hexadécimal (`&#nnn;`, `&#xNN;`) — écrits
  // ainsi parce qu'un exemple complet ressemblerait à une couleur en dur, et
  // le garde-fou du système de jetons le refuserait, à raison : il ne souffre
  // aucune exception. Bornées au plan Unicode valide — une
  // valeur hors bornes ferait lever `String.fromCodePoint`, et un libellé mal
  // formé ne doit pas faire tomber une reprise de commande.
  const dec = /^#(\d{1,7})$/.exec(nom)
  const hex = /^#[xX]([0-9a-fA-F]{1,6})$/.exec(nom)
  const point = dec !== null ? Number(dec[1]) : hex !== null ? parseInt(hex[1]!, 16) : NaN
  if (!Number.isFinite(point) || point < 0 || point > 0x10ffff) return null
  return String.fromCodePoint(point)
}

/**
 * **L'ordre compte, et il n'est pas interchangeable.** Les balises tombent
 * *avant* que les entités ne soient décodées : l'inverse ferait renaître en
 * balise ce qui était écrit `&lt;b&gt;`, et cette balise-là survivrait au
 * nettoyage puisque plus rien ne passerait derrière.
 *
 * Les espaces sont ensuite ramenés à un seul : une mise en forme retirée
 * laisse derrière elle des trous que personne n'a écrits.
 */
export function texteDepuisHtml(brut: string): string {
  return brut
    .replace(COUPURES, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&([a-zA-Z]+|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/g, (tel, nom: string) => {
      return entite(nom) ?? tel
    })
    // `\s` ne couvre pas l'espace insécable rendu par `&nbsp;` dans tous les
    // moteurs : il est nommé explicitement, sans quoi le libellé garde un
    // caractère invisible en fin de ligne.
    .replace(/[\s ]+/g, ' ')
    .trim()
}
