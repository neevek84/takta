import {
  contrastRatio,
  relativeLuminance,
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
  /** bordures, survol — jamais un fond de texte : l'or assombri ne porte plus
   *  son encre qu'à 4,24:1 */
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
  // Assombri par rapport à l'or de survol : l'anneau se pose aussi sur les
  // cellules fériées (`offStrong`), où #b57730 ne tenait que 2,73:1.
  focus: '#a86c2b',

  success: '#e9f0de',
  successInk: '#3b5322',
  successEdge: '#b9ce9b',
  warning: '#fbefd8',
  // Assombri : l'encre d'un état doit tenir 4,5:1 sur *sa* bordure comme sur
  // son fond, et #7a5313 n'atteignait que 4,17:1 sur `warningEdge`.
  warningInk: '#6d4a10',
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
type State = (typeof STATES)[number]

/**
 * Les trois jetons d'un état, déclarés sans cast : un état mal orthographié
 * dans `STATES` ne compilerait plus, là où `` `${s}Ink` as keyof ThemeTokens ``
 * produisait un couple sur un jeton inexistant.
 */
const STATE_TOKENS: Record<
  State,
  { ink: keyof ThemeTokens; fond: keyof ThemeTokens; bordure: keyof ThemeTokens }
> = {
  success: { ink: 'successInk', fond: 'success', bordure: 'successEdge' },
  warning: { ink: 'warningInk', fond: 'warning', bordure: 'warningEdge' },
  danger: { ink: 'dangerInk', fond: 'danger', bordure: 'dangerEdge' },
  info: { ink: 'infoInk', fond: 'info', bordure: 'infoEdge' },
}

/** Les quatre fonds sur lesquels l'application pose du texte courant. */
const FONDS_DE_TEXTE = ['page', 'surface', 'off', 'offStrong'] as const

/**
 * Contrat d'usage : un composant ne pose une encre que sur un fond listé ici.
 * Chaque couple est vérifié à 4,5:1 — sur les palettes livrées par le test de
 * ce module, sur toute palette enregistrée par le service de thème.
 *
 * La liste n'est pas une intention : chaque couple est adossé à une classe
 * `text-*` posée sur un `bg-*` réellement rendu, et `tokens.test.ts` balaie
 * `src/components` et `src/app` pour vérifier qu'aucune combinaison rendue
 * n'en sort. Ne rien y ajouter « par symétrie » : `link` sur `offStrong`, par
 * exemple, n'est rendu nulle part et échouerait sur la palette de la marque.
 *
 * Deux angles morts assumés, hors de portée d'un contrôle sur des couleurs
 * opaques :
 * - les opacités Tailwind (`bg-accent/45` sur les barres de prévisionnel,
 *   1,32:1 sur sa piste) — compensées par `pattern-hatch`, qui porte
 *   l'information sans la teinte ;
 * - `disabled:opacity-60`, qui ramène le libellé d'un bouton plein à 2,50:1 —
 *   exempté par WCAG 1.4.3, un composant inactif n'ayant pas de seuil.
 */
export const TEXT_PAIRS: readonly TokenPair[] = [
  // corps de page, en-têtes et cellules de la grille, badge neutre, bouton
  // secondaire au repos (`bg-surface`) comme au survol (`bg-off`)
  ...FONDS_DE_TEXTE.map((background): TokenPair => ({ text: 'ink', background })),
  // prévisionnel en italique dans la grille, mentions secondaires partout
  ...FONDS_DE_TEXTE.map((background): TokenPair => ({ text: 'muted', background })),
  // liens, bouton discret et boutons de préréglage — tous `hover:bg-off`.
  // Aucun n'est rendu sur `offStrong` : le couple n'est donc pas exigé.
  { text: 'link', background: 'page' },
  { text: 'link', background: 'surface' },
  { text: 'link', background: 'off' },
  // bouton plein : au repos sur l'or, au survol *inversé* sur l'encre
  // profonde. `onAccent` sur `accentDark` n'y figure pas parce qu'aucune
  // classe ne le rend plus — assombrir l'or au lieu de l'inverser le ferait
  // tomber à 4,24:1, et c'est le balayage plus bas qui monte la garde.
  { text: 'onAccent', background: 'accent' },
  { text: 'onDark', background: 'inkDeep' },
  // bandeaux, badges et messages d'état. La bordure est incluse : le bouton
  // `danger` s'y remplit au survol (`hover:bg-danger-edge`), et les trois
  // autres états naîtraient en échec le jour où ils copieraient le motif.
  ...STATES.flatMap((s): TokenPair[] => {
    const t = STATE_TOKENS[s]
    return [
      { text: t.ink, background: t.fond },
      { text: t.ink, background: t.bordure },
      { text: t.ink, background: 'page' },
      { text: t.ink, background: 'surface' },
    ]
  }),
]

/**
 * Éléments non textuels, au seuil de WCAG 1.4.11.
 *
 * `focus` est confronté aux quatre fonds : l'anneau de sélection se pose sur
 * les cellules de la grille (`ring-focus` sur un `<td>` en `bg-off` ou
 * `bg-off-strong`), et l'outline global `:focus-visible` — décalée de 2 px —
 * se dessine sur le fond du parent, donc sur n'importe lequel des quatre.
 *
 * `accentDark` y reste : c'est une bordure et un fond de survol, qui doit
 * rester discernable de la page sans jamais porter d'encre.
 *
 * `rule` en est absent volontairement : un filet décoratif ne porte aucune
 * information, et l'exiger à 3:1 obligerait à remplacer le beige de la marque
 * par un gris qui n'est pas le sien. Les quatre `*Edge` en sont absents pour
 * la même raison — ils doublent une teinte de fond déjà distincte, et leur
 * lisibilité en tant qu'encre est couverte par `TEXT_PAIRS`.
 */
export const NON_TEXT_PAIRS: readonly TokenPair[] = [
  ...FONDS_DE_TEXTE.map((background): TokenPair => ({ text: 'focus', background })),
  { text: 'accentDark', background: 'page' },
  { text: 'accentDark', background: 'surface' },
]

/**
 * Écart minimal de luminance relative entre deux fonds de cellule voisins.
 * Sous cet écart, les trois états de la grille — ouvré, non ouvré, férié —
 * ne se distinguent plus qu'à la teinte.
 */
export const MIN_LUMINANCE_GAP = 0.05

/**
 * Fonds de cellule, du plus clair au plus sombre. L'ordre est l'invariant :
 * une palette qui l'inverse produit un écart négatif, donc un refus.
 */
export const GRID_BACKGROUNDS: readonly (keyof ThemeTokens)[] = ['surface', 'off', 'offStrong']

export interface ContrastIssue {
  kind: 'contraste'
  text: keyof ThemeTokens
  background: keyof ThemeTokens
  ratio: number
  required: number
}

export interface SeparationIssue {
  kind: 'separation'
  /** fond censé être le plus clair des deux */
  lighter: keyof ThemeTokens
  darker: keyof ThemeTokens
  /** écart de luminance mesuré ; négatif si l'ordre est inversé */
  gap: number
  required: number
}

export type ThemeIssue = ContrastIssue | SeparationIssue

/**
 * Le seul contrôle que traverse une palette enregistrée. Il porte les deux
 * exigences du système : chaque couple atteint son seuil de contraste, et les
 * fonds de cellule restent séparés en luminance — sans quoi l'invariant
 * « aucune information n'est portée par la seule couleur » ne tiendrait qu'en
 * test, jamais à l'enregistrement.
 */
export function findContrastIssues(tokens: ThemeTokens): ThemeIssue[] {
  const issues: ThemeIssue[] = []

  for (const [pairs, required] of [
    [TEXT_PAIRS, AA_TEXT_RATIO],
    [NON_TEXT_PAIRS, NON_TEXT_RATIO],
  ] as const) {
    for (const pair of pairs) {
      const ratio = contrastRatio(tokens[pair.text], tokens[pair.background])
      if (ratio < required) {
        issues.push({
          kind: 'contraste',
          text: pair.text,
          background: pair.background,
          ratio,
          required,
        })
      }
    }
  }

  for (let i = 0; i + 1 < GRID_BACKGROUNDS.length; i++) {
    const lighter = GRID_BACKGROUNDS[i]!
    const darker = GRID_BACKGROUNDS[i + 1]!
    const gap = relativeLuminance(tokens[lighter]) - relativeLuminance(tokens[darker])
    if (gap < MIN_LUMINANCE_GAP) {
      issues.push({ kind: 'separation', lighter, darker, gap, required: MIN_LUMINANCE_GAP })
    }
  }

  return issues
}

/**
 * Le seuil n'est jamais tronqué — `formatRatio` tronque vers le bas, ce qui
 * afficherait « 4,99 » pour un seuil futur à 4,999 et ferait mentir le
 * message. Seule la valeur mesurée est tronquée, pour ne jamais afficher
 * « 4,50 » à propos d'un rapport de 4,4999 refusé.
 */
function formatSeuil(value: number): string {
  return value.toFixed(2).replace('.', ',')
}

/** Écart de luminance : trois décimales, un seuil de 0,05 étant fin. */
function formatGap(value: number): string {
  return (Math.floor(value * 1000) / 1000).toFixed(3).replace('.', ',')
}

export function describeContrastIssue(issue: ThemeIssue): string {
  if (issue.kind === 'separation') {
    return (
      `Les fonds « ${TOKEN_LABELS[issue.lighter]} » et « ${TOKEN_LABELS[issue.darker]} » ` +
      `ne se séparent que de ${formatGap(issue.gap)} en luminance ; le minimum exigé est ` +
      `${formatGap(issue.required)}. Sans cet écart, les états de la grille ne se ` +
      `distinguent plus que par la teinte.`
    )
  }

  return (
    `Le couple « ${TOKEN_LABELS[issue.text]} » sur « ${TOKEN_LABELS[issue.background]} » ` +
    `n’atteint que ${formatRatio(issue.ratio)}:1 ; le minimum exigé est ` +
    `${formatSeuil(issue.required)}:1.`
  )
}
