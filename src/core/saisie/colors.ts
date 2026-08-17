export interface LineColor {
  /** classe Tailwind de fond */
  bg: string
  /** classe Tailwind de texte */
  text: string
  /** classe Tailwind de bordure */
  border: string
}

/**
 * Les six teintes de la palette catégorielle (`ThemeTokens.catA`…`catF`,
 * `src/core/theme/tokens.ts`), pas une palette Tailwind par défaut :
 * `design-system.test.ts` interdit toute classe `bg-slate-*`/`bg-sky-*`/etc.
 * en dehors de la définition des jetons, et ce fichier n'y figure pas dans
 * les exemptions.
 *
 * Ce ne sont **pas** `success`/`warning`/`danger`/`info` : ces quatre jetons
 * portent un sens — une prestation affichée en rouge (`danger`) se lirait
 * comme un problème, ce qui serait trompeur — et n'étaient de toute façon que
 * quatre, quand un mois en vue « Tout le mois » peut mêler davantage de
 * prestations simultanées. La palette catégorielle ne juge rien : son seul
 * rôle est de distinguer des prestations entre elles, et `off`/`ink`/`rule`
 * en restent exclus pour la même raison qu'avant — `off` porte déjà le sens
 * « jour non ouvré » dans la grille, et une prestation qui y retomberait par
 * hachage deviendrait indiscernable d'une case de week-end.
 *
 * Les six couples encre/fond et encre/bordure sont validés à 4,5:1 par
 * `TEXT_PAIRS` (`tokens.ts`), et les six fonds sont vérifiés deux à deux à un
 * écart perceptif mesurable (`MIN_CATEGORY_DISTANCE`, même fichier) : deux
 * teintes peuvent chacune tenir le contraste sur un fond clair tout en étant
 * quasi identiques entre elles — c'était exactement le défaut d'`info`/`off`
 * que ce module remplace.
 */
export const LINE_COLORS: readonly LineColor[] = [
  { bg: 'bg-cat-a', text: 'text-cat-a-ink', border: 'border-cat-a-edge' },
  { bg: 'bg-cat-b', text: 'text-cat-b-ink', border: 'border-cat-b-edge' },
  { bg: 'bg-cat-c', text: 'text-cat-c-ink', border: 'border-cat-c-edge' },
  { bg: 'bg-cat-d', text: 'text-cat-d-ink', border: 'border-cat-d-edge' },
  { bg: 'bg-cat-e', text: 'text-cat-e-ink', border: 'border-cat-e-edge' },
  { bg: 'bg-cat-f', text: 'text-cat-f-ink', border: 'border-cat-f-edge' },
]

/** FNV-1a 32 bits — court, déterministe, bien réparti sur des identifiants cuid. */
function hash(texte: string): number {
  let h = 2166136261
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Couleur d'une prestation, dérivée de son seul identifiant.
 *
 * Volontairement sans liste ni index : une couleur attribuée par rang dans un
 * tableau changerait dès qu'une prestation est ajoutée, archivée ou triée
 * autrement — c'est précisément ce que la spec écarte.
 */
export function colorForLine(lineId: string): LineColor {
  return LINE_COLORS[hash(lineId) % LINE_COLORS.length]!
}

/**
 * L'aplat de la prestation saisie quand elle est seule à l'écran.
 *
 * Une couleur catégorielle ne distingue rien s'il n'y a qu'une catégorie :
 * `MonthCalendar` appelait pourtant `colorForLine(line.id)` sans condition, et
 * la seule prestation affichée recevait une teinte tirée au hachage. C'est la
 * cause du « tout est saumon » constaté à l'écran, et c'est aussi pourquoi
 * l'unique couleur de l'application se trouvait affectée à l'information qui,
 * par construction, ne juge rien.
 *
 * Ce n'est pas une septième catégorie : l'aplat dit « saisi », jamais
 * « celle-ci », et il n'entre donc pas dans `LINE_COLORS`.
 *
 * Ce n'est pas non plus `bg-accent`, et c'est le correctif de ce lot : le
 * chiffre du jour reste en `text-ink` **au-dessus** de l'aplat — il doit tenir
 * sur le fond du jour quand une demi-journée ne couvre que la moitié de la
 * case —, et l'accent pleine force ne lui laissait que 1,66 à 4,41:1 sur
 * quatre préréglages. `saisie` est le jeton d'aplat correspondant, tenu à
 * 4,5:1 sous `ink` dans les deux versants comme les six teintes catégorielles.
 * Son encre propre n'est donc jamais rendue : c'est `ink` qui est peint.
 */
export const SAISIE_COLOR: LineColor = {
  bg: 'bg-saisie',
  text: 'text-ink',
  border: 'border-accent-dark',
}

/**
 * La teinte d'un aplat, selon que l'écran montre une prestation ou toutes.
 *
 * `toutLeMois` est la portée choisie par la personne : en « Cette prestation »
 * la teinte ne distinguerait rien, en « Toutes les prestations » elle porte
 * enfin une information.
 */
export function couleurDAplat(lineId: string, toutLeMois: boolean): LineColor {
  return toutLeMois ? colorForLine(lineId) : SAISIE_COLOR
}

/**
 * L'aplat d'un jour prévisionnel.
 *
 * Le passé est froid, le futur est chaud : le réalisé est acquis et refroidi,
 * le prévisionnel est encore en mouvement. Le lot 1f lui donnait le
 * remplissage exact du réalisé — il ne s'en distinguait que par une horloge —
 * et la barre d'engagement le dessinait en accent délavé, c'est-à-dire terne
 * par construction. Ce n'est pas un réalisé moindre : c'est un autre état.
 *
 * Le contour tireté porte la même information sans la teinte.
 */
export const PREVU_COLOR: LineColor = {
  bg: 'bg-prevu',
  // Comme `SAISIE_COLOR` : le chiffre de la case est peint en `text-ink`, pas
  // avec cette encre-ci — elle n'a de sens que là où le prévisionnel porte son
  // propre texte, ce qu'aucun rendu ne fait aujourd'hui.
  text: 'text-prevu-ink',
  border: 'border-prevu-edge',
}
