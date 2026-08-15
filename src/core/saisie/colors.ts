export interface LineColor {
  /** classe Tailwind de fond */
  bg: string
  /** classe Tailwind de texte */
  text: string
  /** classe Tailwind de bordure */
  border: string
}

/**
 * Quatre des vingt-six jetons du système de thème (`src/core/theme/tokens.ts`),
 * pas une palette Tailwind par défaut : `design-system.test.ts` interdit toute
 * classe `bg-slate-*`/`bg-sky-*`/etc. en dehors de la définition des jetons,
 * et ce fichier n'y figure pas dans les exemptions.
 *
 * `off`/`ink`/`rule` — le triplet « neutre » qu'utilise `Badge` — est
 * volontairement exclu : `off` porte déjà le sens « jour non ouvré » dans la
 * grille (`ThemeTokens.off`), et une prestation qui retomberait dessus par
 * hachage deviendrait indiscernable d'une case de week-end.
 *
 * `success`/`warning`/`danger`/`info` restent ainsi la seule base de quatre
 * couples déjà validés à 4,5:1 (`TEXT_PAIRS` dans `tokens.ts`) et déjà rendus
 * ailleurs (`Badge`, `Banner`) : aucun jeton neuf, aucun couple non couvert
 * par le balayage de contraste.
 */
export const LINE_COLORS: readonly LineColor[] = [
  { bg: 'bg-success', text: 'text-success-ink', border: 'border-success-edge' },
  { bg: 'bg-warning', text: 'text-warning-ink', border: 'border-warning-edge' },
  { bg: 'bg-danger', text: 'text-danger-ink', border: 'border-danger-edge' },
  { bg: 'bg-info', text: 'text-info-ink', border: 'border-info-edge' },
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
