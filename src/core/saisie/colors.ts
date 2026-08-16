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
