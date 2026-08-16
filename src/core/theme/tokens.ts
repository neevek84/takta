import {
  contrastRatio,
  relativeLuminance,
  formatRatio,
  parseHexColor,
  AA_TEXT_RATIO,
  NON_TEXT_RATIO,
} from './contrast'

/**
 * Les 44 jetons de couleur du système — 26 de base plus les 18 de la palette
 * catégorielle (six teintes, chacune fond/encre/bordure). Toutes les autres
 * échelles — espacement, rayons, ombres, typographie — sont figées dans
 * `globals.css` : la spec rend les couleurs paramétrables, rien d'autre.
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

  /**
   * Palette catégorielle : six teintes qui ne portent aucun jugement, à la
   * différence de `success`/`warning`/`danger`/`info`. Leur seul rôle est de
   * distinguer des choses entre elles — aujourd'hui les prestations affichées
   * simultanément par la vue calendrier « Tout le mois » (`src/core/saisie/
   * colors.ts`). Une prestation en rouge se lirait comme un problème ; ces six
   * jetons existent pour que ce ne soit jamais le cas.
   */
  catA: string
  catAInk: string
  catAEdge: string
  catB: string
  catBInk: string
  catBEdge: string
  catC: string
  catCInk: string
  catCEdge: string
  catD: string
  catDInk: string
  catDEdge: string
  catE: string
  catEInk: string
  catEEdge: string
  catF: string
  catFInk: string
  catFEdge: string
}

export const THEME_TOKEN_KEYS: readonly (keyof ThemeTokens)[] = [
  'page', 'surface', 'off', 'offStrong',
  'ink', 'inkDeep', 'muted', 'onAccent', 'onDark',
  'accent', 'accentDark', 'link', 'rule', 'focus',
  'success', 'successInk', 'successEdge',
  'warning', 'warningInk', 'warningEdge',
  'danger', 'dangerInk', 'dangerEdge',
  'info', 'infoInk', 'infoEdge',
  'catA', 'catAInk', 'catAEdge',
  'catB', 'catBInk', 'catBEdge',
  'catC', 'catCInk', 'catCEdge',
  'catD', 'catDInk', 'catDEdge',
  'catE', 'catEInk', 'catEEdge',
  'catF', 'catFInk', 'catFEdge',
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
  catA: 'fond de catégorie 1',
  catAInk: 'encre de catégorie 1',
  catAEdge: 'bordure de catégorie 1',
  catB: 'fond de catégorie 2',
  catBInk: 'encre de catégorie 2',
  catBEdge: 'bordure de catégorie 2',
  catC: 'fond de catégorie 3',
  catCInk: 'encre de catégorie 3',
  catCEdge: 'bordure de catégorie 3',
  catD: 'fond de catégorie 4',
  catDInk: 'encre de catégorie 4',
  catDEdge: 'bordure de catégorie 4',
  catE: 'fond de catégorie 5',
  catEInk: 'encre de catégorie 5',
  catEEdge: 'bordure de catégorie 5',
  catF: 'fond de catégorie 6',
  catFInk: 'encre de catégorie 6',
  catFEdge: 'bordure de catégorie 6',
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

  // Palette catégorielle : six teintes chaudes choisies par recherche — pour
  // chacune, fond, bordure et encre sont réglés pour tenir 4,5:1 à la fois
  // (calcul dans `tokens.test.ts`) —, puis vérifiées deux à deux à l'écart
  // perceptif CIE76 (`colorDistance`, `MIN_CATEGORY_DISTANCE`). Aucun hasard
  // dans le choix des teintes : `success`/`warning`/`danger`/`info` n'en
  // offraient que quatre, toutes hors de la famille chaude de la marque.
  catA: '#f29892',
  catAInk: '#3f1512',
  catAEdge: '#c69895',
  catB: '#f2b892',
  catBInk: '#35261d',
  catBEdge: '#eba170',
  catC: '#f7e5bf',
  catCInk: '#352d1d',
  catCEdge: '#f1d59d',
  catD: '#f2e892',
  catDInk: '#35331d',
  catDEdge: '#ebde70',
  catE: '#f292b8',
  catEInk: '#3f1224',
  catEEdge: '#c695a9',
  catF: '#f9e1e5',
  catFInk: '#411018',
  catFEdge: '#dfc3c8',
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

  // Même palette catégorielle que KreativPM : les six teintes ne portent pas
  // l'identité de marque à elles seules — `page`/`ink`/`accent` en sont déjà
  // chargés — et sont indépendantes des autres jetons du préréglage. Rien
  // n'empêche un administrateur de les réétalonner depuis `/admin/theme`.
  catA: '#f29892',
  catAInk: '#3f1512',
  catAEdge: '#c69895',
  catB: '#f2b892',
  catBInk: '#35261d',
  catBEdge: '#eba170',
  catC: '#f7e5bf',
  catCInk: '#352d1d',
  catCEdge: '#f1d59d',
  catD: '#f2e892',
  catDInk: '#35331d',
  catDEdge: '#ebde70',
  catE: '#f292b8',
  catEInk: '#3f1224',
  catEEdge: '#c695a9',
  catF: '#f9e1e5',
  catFInk: '#411018',
  catFEdge: '#dfc3c8',
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

const CATEGORIES = ['catA', 'catB', 'catC', 'catD', 'catE', 'catF'] as const
type Category = (typeof CATEGORIES)[number]

/** Le même triplet que `STATE_TOKENS`, pour la palette catégorielle. */
const CATEGORY_TOKENS: Record<
  Category,
  { ink: keyof ThemeTokens; fond: keyof ThemeTokens; bordure: keyof ThemeTokens }
> = {
  catA: { ink: 'catAInk', fond: 'catA', bordure: 'catAEdge' },
  catB: { ink: 'catBInk', fond: 'catB', bordure: 'catBEdge' },
  catC: { ink: 'catCInk', fond: 'catC', bordure: 'catCEdge' },
  catD: { ink: 'catDInk', fond: 'catD', bordure: 'catDEdge' },
  catE: { ink: 'catEInk', fond: 'catE', bordure: 'catEEdge' },
  catF: { ink: 'catFInk', fond: 'catF', bordure: 'catFEdge' },
}

/** Les six fonds catégoriels, dans l'ordre de déclaration — c'est la liste que balaie la distinction deux à deux. */
export const CATEGORY_BACKGROUNDS: readonly (keyof ThemeTokens)[] = CATEGORIES.map(
  (c) => CATEGORY_TOKENS[c].fond,
)

/** Les quatre fonds sur lesquels l'application pose du texte courant. */
export const FONDS_DE_TEXTE = ['page', 'surface', 'off', 'offStrong'] as const

/**
 * Les quatre encres d'état. Contrairement à `link` — un petit nombre de
 * composants connus, chacun avec son fond documenté — ou à `ink`/`muted`,
 * déjà exigées sur les quatre `FONDS_DE_TEXTE`, ces encres sont pensées pour
 * signaler un état n'importe où dans l'interface : rien n'empêche un futur
 * écran de les poser seules, sans passer par `Badge` ou `Banner`, qui portent
 * toujours leur propre fond dans le même `className`. C'est ce qui les rend
 * exposées à l'angle mort décrit dans `tokens.test.ts`, et c'est pour elles
 * que le balayage confronte une encre trouvée sans fond aux quatre fonds de
 * texte possibles plutôt que de ne former aucun couple.
 */
export const ENCRES_ETAT: readonly (keyof ThemeTokens)[] = STATES.map((s) => STATE_TOKENS[s].ink)

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
  // Encres d'état posées seules, sans fond dans le même `className` : le
  // dépassement en `ChargeTable` et `EngagementBar` (`warningInk`), l'objectif
  // dépassé en `ExerciceBar` (`successInk`), l'erreur de `Field`, `Select` et
  // `TotalsRow` (`dangerInk`). Sans fond explicite, elles héritent de celui du
  // parent — `surface`, `off` ou `offStrong` selon la cellule ou le champ.
  // `infoInk` n'y figure pas : aucune classe ne le pose ainsi aujourd'hui, et
  // l'ajouter « par symétrie » romprait la règle du fichier — c'est le
  // balayage plus bas, adossé à `ENCRES_ETAT`, qui l'exigerait le jour où une
  // classe apparaît.
  { text: 'successInk', background: 'off' },
  { text: 'successInk', background: 'offStrong' },
  { text: 'warningInk', background: 'off' },
  { text: 'warningInk', background: 'offStrong' },
  { text: 'dangerInk', background: 'off' },
  { text: 'dangerInk', background: 'offStrong' },
  // Palette catégorielle : `src/core/saisie/colors.ts` pose toujours `bg-*`
  // et `text-*` (et `border-*`) dans le même `LineColor`, jamais l'encre
  // seule — contrairement aux quatre encres d'état ci-dessus. Le couple sur
  // `page`/`surface` n'est donc pas exigé : aucun rendu ne l'isole ainsi.
  ...CATEGORIES.flatMap((c): TokenPair[] => {
    const t = CATEGORY_TOKENS[c]
    return [
      { text: t.ink, background: t.fond },
      { text: t.ink, background: t.bordure },
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

/**
 * sRGB (0-255) vers CIE XYZ (D65), palier standard de la colorimétrie —
 * `0,04045` est le seuil de linéarisation sRGB usuel, distinct du `0,03928`
 * qu'utilise `relativeLuminance` : celui-ci sert au contraste WCAG, celui-ci
 * sert à situer une teinte dans un espace perceptif, pas à mesurer un rapport
 * de luminance.
 */
function versXyz(hex: string): { x: number; y: number; z: number } {
  const { r, g, b } = parseHexColor(hex)
  const lin = (c: number): number => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  return {
    x: R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    y: R * 0.2126729 + G * 0.7151522 + B * 0.072175,
    z: R * 0.0193339 + G * 0.119192 + B * 0.9503041,
  }
}

/** CIE XYZ (D65) vers CIE L*a*b*. */
function versLab({ x, y, z }: { x: number; y: number; z: number }): {
  l: number
  a: number
  b: number
} {
  const xn = 0.95047
  const yn = 1
  const zn = 1.08883
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(x / xn)
  const fy = f(y / yn)
  const fz = f(z / zn)
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

/**
 * Écart perceptif CIE76 (ΔE*ab) entre deux couleurs `#RRGGBB` — la mesure
 * choisie pour la distinction de la palette catégorielle. Le contraste WCAG
 * ne suffit pas à cet usage : deux teintes peuvent chacune tenir 4,5:1 sur le
 * même fond clair tout en étant quasi identiques entre elles — c'était le
 * défaut d'`info`/`off` que ce module corrige. CIE76 reste une distance
 * euclidienne dans un espace pensé pour l'uniformité perceptive (contrairement
 * à une distance RGB brute, où un même écart numérique ne « paraît » pas le
 * même selon la teinte) ; CIEDE2000 serait plus fidèle mais demande une
 * formule bien plus lourde pour un gain marginal ici, où les six teintes sont
 * déjà bien séparées (voir `MIN_CATEGORY_DISTANCE`).
 */
export function colorDistance(hexA: string, hexB: string): number {
  const a = versLab(versXyz(hexA))
  const b = versLab(versXyz(hexB))
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2)
}

/**
 * Seuil minimal de ΔE*ab entre deux fonds catégoriels. Repères usuels de la
 * colorimétrie : ~2,3 est le plus petit écart perceptible dans des conditions
 * de laboratoire (JND), ~10 marque un écart net « au premier coup d'œil ».
 * Le calendrier pose ces six teintes en petites cellules adjacentes, vues
 * rapidement et pas toujours en pleine attention : 15 retient une marge
 * confortable au-dessus du simple « perceptible », sans réduire l'espace des
 * teintes chaudes disponibles au point de ne plus pouvoir en placer six — la
 * palette livrée ci-dessous tient 20,97 au pire couple, largement au-dessus.
 */
export const MIN_CATEGORY_DISTANCE = 15

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

export interface DistinctionIssue {
  kind: 'distinction'
  a: keyof ThemeTokens
  b: keyof ThemeTokens
  /** écart perceptif CIE76 (ΔE*ab) mesuré entre les deux fonds */
  distance: number
  required: number
}

export type ThemeIssue = ContrastIssue | SeparationIssue | DistinctionIssue

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

  // Distinction deux à deux de la palette catégorielle : le contraste sur le
  // fond ci-dessus ne dit rien de la distance entre deux teintes elles-mêmes.
  for (let i = 0; i + 1 < CATEGORY_BACKGROUNDS.length; i++) {
    for (let j = i + 1; j < CATEGORY_BACKGROUNDS.length; j++) {
      const a = CATEGORY_BACKGROUNDS[i]!
      const b = CATEGORY_BACKGROUNDS[j]!
      const distance = colorDistance(tokens[a], tokens[b])
      if (distance < MIN_CATEGORY_DISTANCE) {
        issues.push({ kind: 'distinction', a, b, distance, required: MIN_CATEGORY_DISTANCE })
      }
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

/** Écart perceptif CIE76 : une décimale, un seuil de 15 n'a pas besoin de plus. */
function formatDistance(value: number): string {
  return (Math.floor(value * 10) / 10).toFixed(1).replace('.', ',')
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

  if (issue.kind === 'distinction') {
    return (
      `Les teintes catégorielles « ${TOKEN_LABELS[issue.a]} » et « ${TOKEN_LABELS[issue.b]} » ` +
      `ne s’écartent que de ${formatDistance(issue.distance)} (ΔE*ab) ; le minimum exigé est ` +
      `${formatDistance(issue.required)}. En dessous, deux prestations affichées côte à côte ` +
      `dans le calendrier deviendraient indiscernables l’une de l’autre.`
    )
  }

  return (
    `Le couple « ${TOKEN_LABELS[issue.text]} » sur « ${TOKEN_LABELS[issue.background]} » ` +
    `n’atteint que ${formatRatio(issue.ratio)}:1 ; le minimum exigé est ` +
    `${formatSeuil(issue.required)}:1.`
  )
}
