/** Seuil WCAG 2.1 AA pour du texte. */
export const AA_TEXT_RATIO = 4.5
/** Seuil WCAG 2.1 AA pour un élément non textuel (bordure, anneau de focus). */
export const NON_TEXT_RATIO = 3

export interface Rgb {
  r: number
  g: number
  b: number
}

const HEX_SIX = /^#[0-9a-fA-F]{6}$/

/**
 * Seule forme acceptée : `#RRGGBB`. La notation à trois chiffres et les noms
 * CSS sont refusés — deux écritures d'une même couleur rendraient toute
 * comparaison de jetons ambiguë, et `<input type="color">` ne produit de
 * toute façon que cette forme.
 */
export function parseHexColor(hex: string): Rgb {
  if (!HEX_SIX.test(hex)) {
    throw new Error(`Couleur invalide : « ${hex} ». Format attendu : #RRGGBB.`)
  }
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  }
}

/** Linéarisation sRGB d'un canal 0-255, formule WCAG 2.1. */
function linearize(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex)
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
}

/** Rapport de contraste WCAG 2.1, entre 1 et 21. Symétrique. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const clair = Math.max(la, lb)
  const sombre = Math.min(la, lb)
  return (clair + 0.05) / (sombre + 0.05)
}

/**
 * Rapport prêt à afficher, tronqué vers le bas. Arrondir ferait afficher
 * « 4,50 » pour un rapport de 4,4999 refusé : le message contredirait la
 * décision.
 */
export function formatRatio(value: number): string {
  return (Math.floor(value * 100) / 100).toFixed(2).replace('.', ',')
}
