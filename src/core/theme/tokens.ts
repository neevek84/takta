import {
  contrastRatio,
  formatRatio,
  AA_TEXT_RATIO,
  NON_TEXT_RATIO,
} from './contrast'

/**
 * Les 26 jetons de couleur du système. Toutes les autres échelles — espacement,
 * rayons, ombres, typographie — sont figées dans `globals.css` : la spec rend
 * les couleurs paramétrables, rien d'autre.
 */
export interface ThemeTokens {
  /** fond de page */
  page: string
  /** fond des surfaces posées sur la page : cartes, cellules ouvrées */
  surface: string
  /** fond des jours non ouvrés */
  off: string
  /** fond des jours fériés */
  offStrong: string

  /** texte principal */
  ink: string
  /** surfaces sombres */
  inkDeep: string
  /** texte secondaire */
  muted: string
  /** texte posé sur un aplat d'accent */
  onAccent: string
  /** texte posé sur une surface sombre */
  onDark: string

  /** aplats : boutons pleins, cellules remplies, barres */
  accent: string
  /** bordures, anneau de focus, survol — jamais un fond de texte */
  accentDark: string
  /** liens et libellés d'action */
  link: string
  /** filets et séparateurs */
  rule: string
  /** anneau de focus */
  focus: string

  success: string
  successInk: string
  successEdge: string
  warning: string
  warningInk: string
  warningEdge: string
  danger: string
  dangerInk: string
  dangerEdge: string
  info: string
  infoInk: string
  infoEdge: string
}

export const THEME_TOKEN_KEYS: readonly (keyof ThemeTokens)[] = [
  'page', 'surface', 'off', 'offStrong',
  'ink', 'inkDeep', 'muted', 'onAccent', 'onDark',
  'accent', 'accentDark', 'link', 'rule', 'focus',
  'success', 'successInk', 'successEdge',
  'warning', 'warningInk', 'warningEdge',
  'danger', 'dangerInk', 'dangerEdge',
  'info', 'infoInk', 'infoEdge',
]

export const TOKEN_LABELS: Record<keyof ThemeTokens, string> = {
  page: 'fond de page',
  surface: 'surface',
  off: 'fond des jours non ouvrés',
  offStrong: 'fond des jours fériés',
  ink: 'encre',
  inkDeep: 'encre profonde',
  muted: 'encre secondaire',
  onAccent: 'encre sur aplat d’accent',
  onDark: 'encre sur fond sombre',
  accent: 'accent',
  accentDark: 'accent foncé',
  link: 'lien',
  rule: 'filet',
  focus: 'anneau de focus',
  success: 'fond de succès',
  successInk: 'encre de succès',
  successEdge: 'bordure de succès',
  warning: 'fond d’avertissement',
  warningInk: 'encre d’avertissement',
  warningEdge: 'bordure d’avertissement',
  danger: 'fond de danger',
  dangerInk: 'encre de danger',
  dangerEdge: 'bordure de danger',
  info: 'fond d’information',
  infoInk: 'encre d’information',
  infoEdge: 'bordure d’information',
}

/**
 * Identité KreativPM, relevée sur kreativpm.fr puis corrigée par le calcul :
 * l'or n'est jamais du texte (2,38:1 sur le crème), et le texte interactif
 * reçoit un ambre assombri à 5,37:1.
 */
export const THEME_KREATIVPM: ThemeTokens = {
  page: '#faf5ed',
  surface: '#ffffff',
  off: '#efeae0',
  offStrong: '#e4dccc',

  ink: '#342820',
  inkDeep: '#2a211a',
  muted: '#5f5e5a',
  onAccent: '#2a211a',
  onDark: '#faf5ed',

  accent: '#d4943f',
  accentDark: '#b57730',
  link: '#8c5a23',
  rule: '#d8cfbf',
  focus: '#b57730',

  success: '#e9f0de',
  successInk: '#3b5322',
  successEdge: '#b9ce9b',
  warning: '#fbefd8',
  warningInk: '#7a5313',
  warningEdge: '#e6c68a',
  danger: '#fae7e0',
  dangerInk: '#8a3418',
  dangerEdge: '#edb9a4',
  info: '#efeae0',
  infoInk: '#4f4636',
  infoEdge: '#d8cfbf',
}

/** Préréglage sobre, pour qui déploie l'application sans la marque. */
export const THEME_NEUTRE: ThemeTokens = {
  page: '#f6f6f5',
  surface: '#ffffff',
  off: '#eeeeed',
  offStrong: '#e2e2e1',

  ink: '#1f2321',
  inkDeep: '#161917',
  muted: '#5a5f5c',
  onAccent: '#ffffff',
  onDark: '#f6f6f5',

  accent: '#3f4744',
  accentDark: '#2c3230',
  link: '#2f4a45',
  rule: '#d5d7d6',
  focus: '#3f4744',

  success: '#e7efe7',
  successInk: '#2f4a33',
  successEdge: '#b7cdb9',
  warning: '#f3eee2',
  warningInk: '#5e4c22',
  warningEdge: '#d8c89e',
  danger: '#f3e7e5',
  dangerInk: '#7a2e24',
  dangerEdge: '#dcb2ac',
  info: '#eaedef',
  infoInk: '#33414a',
  infoEdge: '#c3ccd2',
}

export const DEFAULT_THEME: ThemeTokens = THEME_KREATIVPM

export const THEME_PRESETS: ReadonlyArray<{
  id: 'KREATIVPM' | 'NEUTRE'
  label: string
  tokens: ThemeTokens
}> = [
  { id: 'KREATIVPM', label: 'KreativPM', tokens: THEME_KREATIVPM },
  { id: 'NEUTRE', label: 'Neutre', tokens: THEME_NEUTRE },
]

export interface TokenPair {
  text: keyof ThemeTokens
  background: keyof ThemeTokens
}

const STATES = ['success', 'warning', 'danger', 'info'] as const

/**
 * Contrat d'usage : un composant ne pose une encre que sur un fond listé ici.
 * Chaque couple est vérifié à 4,5:1 — sur les palettes livrées par le test de
 * ce module, sur toute palette enregistrée par le service de thème.
 */
export const TEXT_PAIRS: readonly TokenPair[] = [
  { text: 'ink', background: 'page' },
  { text: 'ink', background: 'surface' },
  { text: 'ink', background: 'off' },
  { text: 'ink', background: 'offStrong' },
  { text: 'muted', background: 'page' },
  { text: 'muted', background: 'surface' },
  { text: 'muted', background: 'off' },
  { text: 'muted', background: 'offStrong' },
  { text: 'link', background: 'page' },
  { text: 'link', background: 'surface' },
  { text: 'onAccent', background: 'accent' },
  { text: 'onDark', background: 'inkDeep' },
  ...STATES.flatMap((s): TokenPair[] => [
    { text: `${s}Ink` as keyof ThemeTokens, background: s },
    { text: `${s}Ink` as keyof ThemeTokens, background: 'page' },
    { text: `${s}Ink` as keyof ThemeTokens, background: 'surface' },
  ]),
]

/**
 * `accentDark` et `focus` ne portent jamais de texte : bordures, anneau de
 * focus, remplissage de barres. Le seuil qui s'applique est celui des
 * éléments non textuels. `rule` en est absent volontairement : un filet
 * décoratif ne porte aucune information, et l'exiger à 3:1 obligerait à
 * remplacer le beige de la marque par un gris qui n'est pas le sien.
 */
export const NON_TEXT_PAIRS: readonly TokenPair[] = [
  { text: 'focus', background: 'page' },
  { text: 'focus', background: 'surface' },
  { text: 'accentDark', background: 'page' },
  { text: 'accentDark', background: 'surface' },
]

export interface ContrastIssue {
  text: keyof ThemeTokens
  background: keyof ThemeTokens
  ratio: number
  required: number
}

export function findContrastIssues(tokens: ThemeTokens): ContrastIssue[] {
  const issues: ContrastIssue[] = []

  for (const [pairs, required] of [
    [TEXT_PAIRS, AA_TEXT_RATIO],
    [NON_TEXT_PAIRS, NON_TEXT_RATIO],
  ] as const) {
    for (const pair of pairs) {
      const ratio = contrastRatio(tokens[pair.text], tokens[pair.background])
      if (ratio < required) {
        issues.push({ text: pair.text, background: pair.background, ratio, required })
      }
    }
  }

  return issues
}

export function describeContrastIssue(issue: ContrastIssue): string {
  return (
    `Le couple « ${TOKEN_LABELS[issue.text]} » sur « ${TOKEN_LABELS[issue.background]} » ` +
    `n’atteint que ${formatRatio(issue.ratio)}:1 ; le minimum exigé est ` +
    `${formatRatio(issue.required)}:1.`
  )
}
