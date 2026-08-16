import {
  contrastRatio,
  formatRatio,
  parseHexColor,
  AA_TEXT_RATIO,
  NON_TEXT_RATIO,
} from './contrast'

/**
 * Les 48 jetons de couleur du système — 30 de base plus les 18 de la palette
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
   * L'aplat d'une case saisie, quand une seule prestation est à l'écran.
   *
   * Ce n'est pas `accent`, et il a fallu une revue pour le voir : le chiffre
   * du jour reste en `ink` **par-dessus** l'aplat, parce qu'une demi-journée
   * ne couvre que la moitié de la case et que ce chiffre doit donc aussi tenir
   * sur le fond du jour. Poser l'accent pleine force sous une encre de corps
   * rendait quatre préréglages sur cinq sous 4,5:1, dont trois sous 2,1:1.
   *
   * Le jeton suit donc la règle de la palette catégorielle plutôt que celle
   * des boutons : une teinte d'aplat, claire sur les versants clairs (L\*≈74)
   * et sombre sur les versants sombres (L\*≈38), où `ink` tient de 5,7 à
   * 8,2:1 par construction. La teinte reste celle de l'accent du préréglage —
   * c'est ce qui la rattache à l'identité sans la rendre illisible.
   */
  saisie: string

  /**
   * Le prévisionnel n'est pas un accent délavé : c'est un autre état, et il a
   * sa teinte. Le lot 1f le dessinait en `bg-accent/45`, une opacité que le
   * contrôle de contraste ne voit pas — angle mort qu'il documentait lui-même.
   * Une teinte opaque entre dans le contrôle ; une opacité n'y entre pas.
   *
   * Comme `saisie`, c'est un **aplat** : il porte le chiffre du jour en `ink`,
   * et sa clarté est donc contrainte des deux côtés — ambre clair en clair,
   * ambre sombre en sombre. L'ambre vif des deux versants sombres ne tenait
   * que 1,74 et 1,77:1 sous l'encre.
   */
  prevu: string
  prevuInk: string
  /**
   * Jamais remplie au survol, contrairement à `dangerEdge` : sur les palettes
   * claires, `prevuInk` n'y tiendrait que 2,74:1. Le contrat retenu est celui
   * de la bordure — 3:1 sur **les quatre** fonds de cellule, et pas seulement
   * sur le blanc : une case prévisionnelle se dessine aussi sur un week-end et
   * sur un férié.
   */
  prevuEdge: string

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
  'accent', 'accentDark', 'link', 'rule', 'focus', 'saisie',
  'success', 'successInk', 'successEdge',
  'warning', 'warningInk', 'warningEdge',
  'danger', 'dangerInk', 'dangerEdge',
  'info', 'infoInk', 'infoEdge',
  'prevu', 'prevuInk', 'prevuEdge',
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
  saisie: 'aplat de saisie',
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
  prevu: 'fond du prévisionnel',
  prevuInk: 'encre du prévisionnel',
  prevuEdge: 'bordure du prévisionnel',
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
 * Palette catégorielle des thèmes **clairs**, reconstruite en LCh au lot 1g.
 *
 * Le lot 1f avait déjà corrigé le vrai défaut de couverture — il vérifiait
 * l'écart *entre teintes*, qui ne dépend pas du fond, et pas l'écart entre une
 * teinte et **la surface qui la porte**. Ce que la palette qu'il a livrée
 * n'avait pas, c'est l'unité : ses six chromas valaient 25 · 50 · 81 · 42 · 28
 * · 40, soit un rapport de 3,2 entre `catC` qui hurlait et `catA` qui
 * s'effaçait. Six teintes de chromas différents ne forment pas une famille,
 * elles forment une collection.
 *
 * Le correctif est donc l'**égalité**, pas la baisse : six secteurs de teinte
 * répartis (20°, 80°, 140°, 200°, 260°, 320°), une clarté commune, et le
 * **même chroma pour les six**. C*39 est le point retenu — une première
 * tentative à 24 a été jugée terne par le porteur.
 *
 * Clair : L*74 / C*39 (fond), L*23 / C*17,5 (encre), L*68 / C*38 (bordure).
 * La clarté du fond descend de 78 à 74 parce que C*39 n'est pas atteignable
 * dans le gamut sRGB à L*78 sur les teintes 20° et 260° : y rester aurait
 * rendu deux teintes plus pâles que les quatre autres, c'est-à-dire aurait
 * reproduit le défaut qu'on corrige.
 */
const CATEGORIES_CLAIR = {
  catA: '#fc9b9f', catAInk: '#502d2f', catAEdge: '#e98c90',
  catB: '#d8b06f', catBInk: '#43351d', catBEdge: '#c6a062',
  catC: '#8cc487', catCInk: '#283c26', catCEdge: '#7eb378',
  catD: '#2cc9cd', catDInk: '#033e3f', catDEdge: '#12b8bc',
  catE: '#6dbdfc', catEInk: '#1c3950', catEEdge: '#5eade9',
  catF: '#d7a4e4', catFInk: '#433048', catFEdge: '#c695d2',
} as const

/**
 * Palette catégorielle des thèmes **sombres**, construite et non dérivée.
 *
 * Rien n'y est l'inverse de `CATEGORIES_CLAIR` : les fonds descendent à L*38
 * et leur chroma commun tombe à 24,5 — nettement sous les trois quarts du
 * clair, ce que `tokens.test.ts` exige. Une inversion de clarté aurait
 * conservé le chroma du clair et produit six aplats criards sur fond sombre.
 *
 * Sombre : L*38 / C*24,5 (fond), L*91 / C*12 (encre), L*43 / C*26,5 (bordure).
 * La bordure est ici **plus claire** que le fond, et l'encre reste en deçà du
 * blanc pur.
 */
const CATEGORIES_SOMBRE = {
  catA: '#804a4d', catAInk: '#fedede', catAEdge: '#905558',
  catB: '#6c5632', catBInk: '#f3e3cf', catBEdge: '#7a623a',
  catC: '#42613f', catCInk: '#d9ead6', catCEdge: '#4c6e49',
  catD: '#046466', catDInk: '#c9eced', catDEdge: '#0a7174',
  catE: '#305d80', catEInk: '#d5e7fc', catEEdge: '#386a90',
  catF: '#6c5073', catFInk: '#f1e0f4', catFEdge: '#7a5b82',
} as const

/**
 * Identité KreativPM, relevée sur kreativpm.fr puis corrigée par le calcul :
 * l'or n'est jamais du texte (2,38:1 sur le crème), et le texte interactif
 * reçoit un ambre assombri à 5,37:1.
 *
 * Depuis le lot 1f, ce n'est plus le défaut mais un préréglage — la marque
 * habille l'application, elle ne la définit plus.
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
  // L'aplat d'une case saisie : l'or de la marque ramené à la clarté d'un
  // aplat (L*74), où l'encre du chiffre tient 7,03:1. L'or pleine force n'y
  // tenait que 5,51:1 — le seul des cinq préréglages à passer, et de peu.
  // Le chroma descend à 20 pour s'écarter de l'ambre du prévisionnel : à C*39
  // les deux aplats n'étaient qu'à 14,3 (ΔE*ab) l'un de l'autre, sous le seuil
  // de distinction que ce module applique à la palette catégorielle. À 20, ils
  // s'écartent de 32,3 — et le réalisé ne se lit plus comme un prévisionnel
  // pâle sur la palette de la marque.
  saisie: '#ceb193',

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

  // La bordure est assombrie par rapport à l'ambre du fond : elle doit tenir
  // 3:1 jusque sur le fond des fériés (`#e4dccc`), où un ambre clair tombe
  // sous 2,3:1.
  prevu: '#e8b45c',
  prevuInk: '#48300a',
  // Assombrie : la bordure se dessine **sur** l'ambre qu'elle borde, et
  // #9d7010 n'y tenait que 2,34:1 — un marqueur non chromatique invisible.
  prevuEdge: '#795109',

  // Les six teintes catégorielles ne portent pas l'identité de marque à elles
  // seules — `page`/`ink`/`accent` en sont déjà chargés. Elles sont donc
  // celles de tout thème clair, et c'est le calcul qui l'autorise : mesurées
  // sur *ce* fond crème, elles gardent 24,6 au pire face aux quatre fonds.
  // Les six teintes chaudes du lot 1e, elles, tombaient à 10,0.
  ...CATEGORIES_CLAIR,
}

/**
 * Thème clair — le défaut depuis le lot 1f. Neutre et dense : rien n'y attire
 * l'œil que les chiffres. Les fonds de grille sont plus étagés que ceux de
 * l'ancien préréglage neutre (ΔL* 8,3 et 6,0 contre 5,9 et 4,2), la lisibilité
 * de la grille étant le motif même du lot.
 */
export const THEME_CLAIR: ThemeTokens = {
  page: '#f6f6f5',
  surface: '#ffffff',
  off: '#e9e9e8',
  offStrong: '#d8d8d7',

  ink: '#1f2321',
  inkDeep: '#161917',
  muted: '#555956',
  onAccent: '#ffffff',
  onDark: '#f6f6f5',

  accent: '#3f4744',
  accentDark: '#2c3230',
  link: '#2f4a45',
  rule: '#cdcecd',
  focus: '#3f4744',
  saisie: '#9fbcb1',

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

  prevu: '#f2b544',
  prevuInk: '#4a2f05',
  prevuEdge: '#7c5500',

  ...CATEGORIES_CLAIR,
}

/**
 * Thème sombre — **construit, pas dérivé**.
 *
 * Aucun jeton n'est l'inverse de clarté de son homologue clair. Les fonds
 * s'étagent dans le bas de l'échelle (L* 19,7 / 13,6 / 9,7 / 5,0 pour
 * surface / page / off / offStrong, en gardant l'ordre du clair : la surface
 * ouvrée au-dessus de la page, les jours chômés en dessous), l'encre s'arrête
 * à L*≈92 au lieu du blanc pur, et les accents perdent en saturation ce qu'ils
 * gagneraient en criard. Inverser les luminances du clair aurait conservé ses
 * saturations et produit exactement l'interface grise et sale que la spec
 * écarte — `tokens.test.ts` le vérifie en comparant les chromas.
 */
export const THEME_SOMBRE: ThemeTokens = {
  page: '#202329',
  surface: '#2c3037',
  off: '#181b20',
  offStrong: '#0f1114',

  ink: '#e6e8ec',
  inkDeep: '#0a0c0e',
  muted: '#a4abb4',
  onAccent: '#10131a',
  onDark: '#e6e8ec',

  accent: '#7fa8d6',
  accentDark: '#557fae',
  link: '#9bc0e8',
  rule: '#3a3f47',
  focus: '#9bc0e8',
  // L'aplat descend à la clarté des aplats catégoriels sombres (L*38) : le
  // bleu clair de l'accent ne portait l'encre du chiffre qu'à 2,02:1.
  saisie: '#375c80',

  success: '#1b2a20',
  successInk: '#8fd0a2',
  successEdge: '#2f4a38',
  warning: '#2b2417',
  warningInk: '#e0be74',
  warningEdge: '#4a3d21',
  danger: '#2c1c19',
  dangerInk: '#f0a08c',
  dangerEdge: '#4d2f28',
  info: '#1b232b',
  infoInk: '#a8c4d8',
  infoEdge: '#31414e',

  // Sur fond sombre, la contrainte s'inverse : la bordure doit être assez
  // *claire* pour tenir 3:1 sur la surface ouvrée, le plus clair des quatre
  // fonds de cellule.
  // Un ambre d'aplat, et non l'ambre vif du clair : le chiffre du jour se
  // pose dessus en `ink`, quasi blanc ici, et l'ambre clair ne lui laissait
  // que 1,74:1. L'encre du prévisionnel s'inverse en conséquence, comme les
  // encres catégorielles sombres, et la bordure passe au-dessus du fond.
  prevu: '#7c4f2c',
  prevuInk: '#f3e3cf',
  prevuEdge: '#dcaf64',

  ...CATEGORIES_SOMBRE,
}

/**
 * Encre — l'identité propre de CRA, distincte de la marque comme du neutre.
 *
 * `onAccent` n'est plus blanc : l'accent est vif et clair (L*≈55), et le blanc
 * n'y tiendrait pas 4,5:1. Une encre teal très sombre autorise un accent bien
 * plus lumineux qu'un teal sombre à texte blanc — c'est ce choix, et lui seul,
 * qui retire la grisaille que le porteur a constatée.
 */
export const THEME_ENCRE_CLAIR: ThemeTokens = {
  page: '#eaf2ef',
  surface: '#ffffff',
  off: '#dbe8e3',
  offStrong: '#c8dad4',

  ink: '#12211d',
  inkDeep: '#0a1512',
  muted: '#485853',
  onAccent: '#031c18',
  onDark: '#eaf2ef',

  accent: '#0e9480',
  accentDark: '#0b7566',
  link: '#0a6355',
  rule: '#aec5bd',
  focus: '#0b7566',
  saisie: '#51c9b2',

  success: '#dff0e2',
  successInk: '#1e5232',
  successEdge: '#98c9a8',
  warning: '#fbecd0',
  warningInk: '#6b4708',
  warningEdge: '#e5bf72',
  danger: '#fbe3dc',
  dangerInk: '#7f2c17',
  dangerEdge: '#e8a894',
  info: '#dfebef',
  infoInk: '#24454f',
  infoEdge: '#aac6ce',

  // Le fond des fériés est ici plus sombre que sur le neutre (`#c8dad4`) : la
  // bordure du prévisionnel descend d'autant pour y tenir ses 3:1.
  prevu: '#f2b544',
  prevuInk: '#4a2f05',
  prevuEdge: '#7c5500',

  ...CATEGORIES_CLAIR,
}

/** Construite, pas inversée : son chroma catégoriel est inférieur au clair. */
export const THEME_ENCRE_SOMBRE: ThemeTokens = {
  page: '#121a18',
  surface: '#1e2a27',
  off: '#111917',
  offStrong: '#050807',

  ink: '#e2ece9',
  inkDeep: '#060a09',
  muted: '#9fb0ab',
  onAccent: '#04211c',
  onDark: '#e2ece9',

  accent: '#3fc9b0',
  accentDark: '#2ba792',
  link: '#5fd8c0',
  rule: '#33443f',
  focus: '#5fd8c0',
  saisie: '#1f6458',

  success: '#14291c',
  successInk: '#86d09a',
  successEdge: '#294733',
  warning: '#2b2513',
  warningInk: '#e0bf6e',
  warningEdge: '#4b3e1c',
  danger: '#2c1b16',
  dangerInk: '#f0a189',
  dangerEdge: '#4e2f25',
  info: '#16242a',
  infoInk: '#a2c7d0',
  infoEdge: '#2d454e',

  prevu: '#7c4f2c',
  prevuInk: '#f3e3cf',
  prevuEdge: '#dcaf64',

  ...CATEGORIES_SOMBRE,
}

/**
 * Palette de repli, et seule palette que `globals.css` déclare en dur. Encre
 * clair : c'est le thème qu'un poste sans préférence, ou une base vide, doit
 * obtenir.
 */
export const DEFAULT_THEME: ThemeTokens = THEME_ENCRE_CLAIR

/**
 * Nature d'un préréglage : sur quel versant du thème il peut être appliqué.
 * L'écran d'administration s'en sert pour ne pas proposer un préréglage clair
 * dans l'emplacement sombre — ce que `findConfigIssues` refuserait de toute
 * façon, mais qu'il vaut mieux ne pas laisser tenter.
 */
export type ThemeNature = 'clair' | 'sombre'

export const THEME_PRESETS: ReadonlyArray<{
  id: 'ENCRE_CLAIR' | 'ENCRE_SOMBRE' | 'CLAIR' | 'SOMBRE' | 'KREATIVPM'
  label: string
  nature: ThemeNature
  tokens: ThemeTokens
}> = [
  { id: 'ENCRE_CLAIR', label: 'Encre clair', nature: 'clair', tokens: THEME_ENCRE_CLAIR },
  { id: 'ENCRE_SOMBRE', label: 'Encre sombre', nature: 'sombre', tokens: THEME_ENCRE_SOMBRE },
  { id: 'CLAIR', label: 'Neutre clair', nature: 'clair', tokens: THEME_CLAIR },
  { id: 'SOMBRE', label: 'Neutre sombre', nature: 'sombre', tokens: THEME_SOMBRE },
  { id: 'KREATIVPM', label: 'KreativPM', nature: 'clair', tokens: THEME_KREATIVPM },
]

/**
 * Comment le thème appliqué se choisit.
 *
 * `systeme` est le défaut : la feuille injectée porte les deux palettes et
 * laisse `prefers-color-scheme` trancher, sans JavaScript ni scintillement.
 * Un choix explicite — `clair` ou `sombre` — remplace cette préférence ; il
 * vit dans la ligne singleton des réglages, et survit donc à un redémarrage
 * comme à un vidage du navigateur.
 *
 * La spec écarte un thème *par utilisateur* (§7) : l'application est
 * mono-organisation. Le mode est un réglage d'instance, la préférence du
 * système reste, elle, propre à chaque poste.
 */
export const THEME_MODES = ['systeme', 'clair', 'sombre'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

export const THEME_MODE_LABELS: Record<ThemeMode, string> = {
  systeme: 'Suivre la préférence du système',
  clair: 'Toujours clair',
  sombre: 'Toujours sombre',
}

/** Les deux palettes et la règle qui décide laquelle s'applique. */
export interface ThemeConfig {
  mode: ThemeMode
  clair: ThemeTokens
  sombre: ThemeTokens
}

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'systeme',
  clair: THEME_ENCRE_CLAIR,
  sombre: THEME_ENCRE_SOMBRE,
}

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
  // Aplat du prévisionnel : calendrier, grille, réglette et légende. La
  // bordure n'y figure pas — voir `prevuEdge`, tenu à 3:1 comme élément non
  // textuel, et jamais rempli.
  { text: 'prevuInk', background: 'prevu' },
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
  // L'aplat d'une case du calendrier (lot 1f) : le fond catégoriel de la
  // prestation saisie, avec le chiffre de la case **par-dessus**, en `ink`.
  // Ce n'est pas le couple encre/fond de `colors.ts` — le chiffre reste `ink`
  // parce qu'une demi-journée ne couvre que la moitié de la case, et qu'il
  // doit donc aussi tenir sur le fond du jour, déjà exigé plus haut.
  //
  // Le balayage de `tokens.test.ts` ne peut pas former ce couple seul : le
  // fond vient d'une variable (`colorForLine(line.id).bg`) et l'encre d'un
  // autre `className` que le sien. Il est donc déclaré ici, à la main, comme
  // le contrat d'usage l'exige.
  ...CATEGORY_BACKGROUNDS.map((background): TokenPair => ({ text: 'ink', background })),
  // Les deux autres teintes que le **même** chiffre peut recevoir sous lui, et
  // que le lot 1g avait mises en service sans les déclarer : l'aplat de la
  // prestation saisie en portée « Cette prestation » — la portée par défaut —
  // et l'aplat du prévisionnel. Elles sont hors de portée du balayage pour la
  // raison exacte des six ci-dessus, et le contrat vaut donc ici : un aplat
  // qui n'entre pas dans cette liste rend un chiffre que personne n'a mesuré.
  // `src/core/saisie/colors.test.ts` dérive la liste des aplats possibles et
  // exige que chacun y figure.
  { text: 'ink', background: 'saisie' },
  { text: 'ink', background: 'prevu' },
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
  // Le contour tireté d'une case prévisionnelle : c'est lui, et non la teinte,
  // qui porte l'état quand la couleur n'est pas perçue. Il se dessine sur les
  // quatre fonds de cellule — ouvré, week-end, férié — donc il est exigé sur
  // les quatre. Le mesurer sur le seul blanc laissait `#c1860f` à 2,20:1 sur
  // les fériés, c'est-à-dire un marqueur non chromatique invisible.
  ...FONDS_DE_TEXTE.map((background): TokenPair => ({ text: 'prevuEdge', background })),
  // Et sur le fond qu'il borde vraiment. Le tireté du segment de prévisionnel
  // (`EngagementBar`, `SegmentLegend`) se dessine **sur son propre
  // remplissage** : le confronter aux seuls fonds de cellule laissait ce
  // marqueur entre 1,52 et 2,53:1 sur les cinq préréglages, c'est-à-dire
  // laissait l'information reposer sur la seule couleur.
  { text: 'prevuEdge', background: 'prevu' },
]

/**
 * Écart minimal de **clarté CIE (L\*)** entre deux fonds de cellule voisins.
 * Sous cet écart, les trois états de la grille — ouvré, non ouvré, férié — ne
 * se distinguent plus qu'à la teinte.
 *
 * Le lot 1e mesurait cet écart en luminance relative WCAG (Y ≥ 0,05). Cette
 * grandeur n'est pas perceptivement uniforme : elle s'écrase près du noir. Un
 * thème sombre ne peut structurellement pas y satisfaire — trois fonds séparés
 * de 0,05 en Y demanderaient une surface la plus claire à Y ≥ 0,10, soit un
 * gris moyen, ce qui n'est plus un thème sombre. Le seuil n'a pas été baissé :
 * la grandeur a été changée pour celle qui mesure ce qu'on veut mesurer.
 *
 * Le contrôle ne s'en trouve pas affaibli côté clair, au contraire. Près du
 * blanc (L\*≈95), la dérivée dY/dL\* vaut ≈0,024 : ΔL\* ≥ 4 y impose ΔY ≳ 0,09,
 * soit près du double de l'ancien seuil. `tokens.test.ts` le vérifie plutôt que
 * de le croire sur parole.
 *
 * La valeur : ~1 unité de L\* est le plus petit pas perceptible sur de grandes
 * plages adjacentes ; 4 garde une marge de sécurité sans interdire les
 * étagements serrés dont un thème sombre a besoin. Les trois palettes livrées
 * tiennent entre 4,66 et 8,30.
 */
export const MIN_LIGHTNESS_GAP = 4

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

/** Clarté CIE L\*, de 0 (noir) à 100 (blanc). Perceptivement uniforme. */
export function lightness(hex: string): number {
  return versLab(versXyz(hex)).l
}

/**
 * Chroma CIE C\*ab — la « pureté » d'une teinte, indépendante de sa clarté.
 * Sert à vérifier que le thème sombre n'est pas une inversion du clair : une
 * inversion conserve le chroma, une construction le baisse.
 */
export function chroma(hex: string): number {
  const { a, b } = versLab(versXyz(hex))
  return Math.sqrt(a * a + b * b)
}

/**
 * Seuil minimal de ΔE*ab entre deux fonds catégoriels. Repères usuels de la
 * colorimétrie : ~2,3 est le plus petit écart perceptible dans des conditions
 * de laboratoire (JND), ~10 marque un écart net « au premier coup d'œil ».
 * Le calendrier pose ces six teintes en petites cellules adjacentes, vues
 * rapidement et pas toujours en pleine attention : 15 retient une marge
 * confortable au-dessus du simple « perceptible », sans réduire l'espace des
 * teintes chaudes disponibles au point de ne plus pouvoir en placer six — la
 * palette livrée ci-dessous tient 24,11 au pire couple, largement au-dessus.
 *
 * Le chiffre est **mesuré**, sur toutes les `DISTINCTION_PAIRS` des cinq
 * préréglages : 24,11 est `catA`/`catF` sur les versants sombres, qui
 * partagent `CATEGORIES_SOMBRE`. Le 20,97 qu'annonçait ce commentaire datait
 * du lot 1f — c'était l'écart de la palette chaude du lot 1e, et il a survécu
 * au remplacement complet de la palette. `tokens.test.ts` confronte désormais
 * ce nombre-ci au calcul : il ne peut plus se périmer en silence.
 */
export const MIN_CATEGORY_DISTANCE = 15

/**
 * Toutes les paires de surfaces qui doivent rester discernables l'une de
 * l'autre — **dérivées, jamais énumérées**.
 *
 * Deux familles, et la seconde est celle qui manquait :
 *
 * 1. les six fonds catégoriels deux à deux — deux prestations affichées côte à
 *    côte dans le calendrier ;
 * 2. chaque fond catégoriel contre chacun des `FONDS_DE_TEXTE` — une cellule
 *    *remplie* contre une cellule *vide*. Le lot 1e ne vérifiait que la
 *    première famille, et la seconde échouait en silence sur les deux palettes
 *    livrées : `catF` n'était qu'à 10,0 (ΔE\*ab) du fond des week-ends sur la
 *    palette de la marque, `catC` à 12,5 du fond des fériés. La distance entre
 *    deux teintes ne dépend pas du fond ; la distance d'une teinte à son fond,
 *    si — c'est tout l'objet du soupçon « c'est peut-être mon thème
 *    d'entreprise qui fout le bazar », et il était fondé.
 *
 * Écrire ces 39 paires à la main les aurait rendues fausses à la première
 * septième catégorie. Elles se déduisent de `CATEGORY_BACKGROUNDS` et de
 * `FONDS_DE_TEXTE`, qui se déduisent eux-mêmes de `CATEGORIES` et du contrat
 * d'usage — ajouter une catégorie ajoute ses paires sans qu'on y pense.
 *
 * Ce que la liste n'inclut délibérément pas : les `FONDS_DE_TEXTE` entre eux.
 * `page` et `surface` sont voisins **par construction** dans les trois thèmes,
 * et leur étagement utile — celui de la grille — relève de `GRID_BACKGROUNDS`
 * et de son écart de clarté, pas d'un écart de teinte.
 */
export const DISTINCTION_PAIRS: readonly {
  a: keyof ThemeTokens
  b: keyof ThemeTokens
}[] = [
  ...CATEGORY_BACKGROUNDS.flatMap((a, i) =>
    CATEGORY_BACKGROUNDS.slice(i + 1).map((b) => ({ a, b })),
  ),
  ...CATEGORY_BACKGROUNDS.flatMap((a) => FONDS_DE_TEXTE.map((b): { a: keyof ThemeTokens; b: keyof ThemeTokens } => ({ a, b }))),
]

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
  /** écart de clarté L\* mesuré ; négatif si l'ordre est inversé */
  gap: number
  required: number
}

/**
 * Une palette rangée du mauvais côté : un thème clair dont la page est plus
 * sombre que son encre, ou l'inverse. Sans ce contrôle, coller la palette
 * claire dans l'emplacement sombre s'enregistrerait sans un mot — chaque
 * couple tenant son contraste — et l'utilisateur qui bascule son système en
 * sombre recevrait un aplat blanc en pleine nuit.
 */
export interface PolarityIssue {
  kind: 'polarite'
  attendu: ThemeNature
  /** clarté L\* du fond de page */
  pageLightness: number
  /** clarté L\* de l'encre */
  inkLightness: number
}

export interface DistinctionIssue {
  kind: 'distinction'
  a: keyof ThemeTokens
  b: keyof ThemeTokens
  /** écart perceptif CIE76 (ΔE*ab) mesuré entre les deux fonds */
  distance: number
  required: number
}

export type ThemeIssue = ContrastIssue | SeparationIssue | DistinctionIssue | PolarityIssue

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
    const gap = lightness(tokens[lighter]) - lightness(tokens[darker])
    if (gap < MIN_LIGHTNESS_GAP) {
      issues.push({ kind: 'separation', lighter, darker, gap, required: MIN_LIGHTNESS_GAP })
    }
  }

  // Distinction des surfaces : ni le contraste ci-dessus, ni l'étagement de
  // clarté ne disent quoi que ce soit de la distance de teinte entre deux
  // aplats. La liste des paires est dérivée — voir `DISTINCTION_PAIRS`.
  for (const { a, b } of DISTINCTION_PAIRS) {
    const distance = colorDistance(tokens[a], tokens[b])
    if (distance < MIN_CATEGORY_DISTANCE) {
      issues.push({ kind: 'distinction', a, b, distance, required: MIN_CATEGORY_DISTANCE })
    }
  }

  return issues
}

/**
 * Le contrôle complet d'une configuration : les deux palettes, chacune passée
 * au crible de `findContrastIssues`, plus la polarité de chacune. Le mode ne
 * s'y contrôle pas — c'est une énumération, et le schéma du service la refuse
 * avant d'arriver ici.
 *
 * Le versant est rendu avec le défaut : sans lui, un message d'erreur nommerait
 * un couple fautif sans dire dans laquelle des deux palettes le corriger.
 */
export function findConfigIssues(
  config: ThemeConfig,
): { palette: ThemeNature; issue: ThemeIssue }[] {
  const out: { palette: ThemeNature; issue: ThemeIssue }[] = []
  for (const palette of ['clair', 'sombre'] as const) {
    const tokens = config[palette]
    for (const issue of findPolarityIssues(tokens, palette)) out.push({ palette, issue })
    for (const issue of findContrastIssues(tokens)) out.push({ palette, issue })
  }
  return out
}

/**
 * Une palette claire a sa page plus claire que son encre ; une palette sombre,
 * l'inverse. C'est le seul invariant qui distingue les deux emplacements —
 * tous les autres contrôles sont symétriques et ne verraient pas l'échange.
 */
export function findPolarityIssues(
  tokens: ThemeTokens,
  attendu: ThemeNature,
): PolarityIssue[] {
  const pageLightness = lightness(tokens.page)
  const inkLightness = lightness(tokens.ink)
  const clair = pageLightness > inkLightness
  if (clair === (attendu === 'clair')) return []
  return [{ kind: 'polarite', attendu, pageLightness, inkLightness }]
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

/** Écart de clarté L\* : une décimale, un seuil de 4 n'a pas besoin de plus. */
function formatGap(value: number): string {
  return (Math.floor(value * 10) / 10).toFixed(1).replace('.', ',')
}

/** Écart perceptif CIE76 : une décimale, un seuil de 15 n'a pas besoin de plus. */
function formatDistance(value: number): string {
  return (Math.floor(value * 10) / 10).toFixed(1).replace('.', ',')
}

export function describeContrastIssue(issue: ThemeIssue): string {
  if (issue.kind === 'separation') {
    return (
      `Les fonds « ${TOKEN_LABELS[issue.lighter]} » et « ${TOKEN_LABELS[issue.darker]} » ` +
      `ne se séparent que de ${formatGap(issue.gap)} en clarté (L*) ; le minimum exigé est ` +
      `${formatGap(issue.required)}. Sans cet écart, les états de la grille ne se ` +
      `distinguent plus que par la teinte.`
    )
  }

  if (issue.kind === 'polarite') {
    return issue.attendu === 'sombre'
      ? `La palette sombre est en réalité une palette claire : son fond de page ` +
          `(L* ${formatGap(issue.pageLightness)}) est plus clair que son encre ` +
          `(L* ${formatGap(issue.inkLightness)}). Un poste réglé en sombre recevrait un ` +
          `aplat clair en pleine nuit.`
      : `La palette claire est en réalité une palette sombre : son fond de page ` +
          `(L* ${formatGap(issue.pageLightness)}) est plus sombre que son encre ` +
          `(L* ${formatGap(issue.inkLightness)}).`
  }

  if (issue.kind === 'distinction') {
    return (
      `Les surfaces « ${TOKEN_LABELS[issue.a]} » et « ${TOKEN_LABELS[issue.b]} » ` +
      `ne s’écartent que de ${formatDistance(issue.distance)} (ΔE*ab) ; le minimum exigé est ` +
      `${formatDistance(issue.required)}. En dessous, deux prestations affichées côte à côte ` +
      `dans le calendrier — ou une cellule remplie et une cellule vide — deviendraient ` +
      `indiscernables l’une de l’autre.`
    )
  }

  return (
    `Le couple « ${TOKEN_LABELS[issue.text]} » sur « ${TOKEN_LABELS[issue.background]} » ` +
    `n’atteint que ${formatRatio(issue.ratio)}:1 ; le minimum exigé est ` +
    `${formatSeuil(issue.required)}:1.`
  )
}
