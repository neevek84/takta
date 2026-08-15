import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const RACINE = join(process.cwd(), 'src')

// Les seuls endroits où **une couleur** a le droit d'être écrite en clair : la
// définition des jetons, et la feuille qui les déclare en variables CSS.
//
// Cette exemption ne vaut QUE pour les couleurs. `globals.css` est justement le
// fichier où une seule ligne suffit à supprimer le focus partout à la fois :
// l'exempter du contrôle de focus reviendrait à ne pas en avoir. Voir
// `FICHIERS` (tous) contre `FICHIERS_SANS_JETONS` (couleurs seulement).
const EXEMPTS_COULEUR = [
  join('core', 'theme', 'tokens.ts'),
  join('app', 'globals.css'),
]

function sources(dossier: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) out.push(...sources(chemin))
    else if (/\.(ts|tsx|css)$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) {
      out.push(chemin)
    }
  }
  return out
}

/** Tous les fichiers de source, jetons compris : c'est la liste du focus. */
const FICHIERS = sources(RACINE)

/** Sans la définition des jetons : c'est la liste des couleurs. */
const FICHIERS_SANS_JETONS = FICHIERS.filter(
  (chemin) => !EXEMPTS_COULEUR.some((exempt) => chemin.endsWith(exempt)),
)

function lit(chemin: string): string {
  return readFileSync(chemin, 'utf8')
}

/**
 * Contenu débarrassé de ses commentaires. Un commentaire qui *nomme* une
 * classe — « le nom que Tailwind attend pour `bg-accent-dark` » — documente la
 * règle, il ne l'enfreint pas.
 */
function sansCommentaires(contenu: string): string {
  return contenu.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function noms(chemins: string[]): string[] {
  return chemins.map((chemin) => relative(RACINE, chemin))
}

function fautifs(fichiers: string[], predicat: (contenu: string) => boolean): string[] {
  return noms(fichiers.filter((chemin) => predicat(lit(chemin))))
}

const PREFIXES_DE_COULEUR =
  'bg|text|border|ring|from|via|to|decoration|outline|accent|fill|stroke|divide|shadow|caret|placeholder'

const PALETTE_TAILWIND = new RegExp(
  `\\b(?:${PREFIXES_DE_COULEUR})-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b`,
)

// `white` et `black` sont des couleurs de la palette Tailwind au même titre que
// `slate-100` : elles ne suivent simplement aucun jeton. `transparent`,
// `current` et `inherit` restent permises — ce ne sont pas des couleurs mais
// l'absence de couleur, ou celle déjà héritée d'un jeton.
const PALETTE_SANS_SUFFIXE = new RegExp(`\\b(?:${PREFIXES_DE_COULEUR})-(?:white|black)\\b`)

// `bg-[#ff0000]`, `text-[rgb(255,0,0)]`, `border-[hsl(0_100%_50%)]` : la valeur
// arbitraire contourne la palette *et* les jetons.
const VALEUR_ARBITRAIRE = new RegExp(
  `\\b(?:${PREFIXES_DE_COULEUR})-\\[(?:#|(?:rgba?|hsla?|oklch|oklab|lab|lch|color|color-mix)\\()`,
)

// Une fonction de couleur écrite en clair, où que ce soit hors de la feuille
// de jetons : `rgb(255,0,0)` n'a pas de `#`, le test hexadécimal ne la voit pas.
const FONCTION_DE_COULEUR = /\b(?:rgba?|hsla?|oklch|oklab)\s*\(/

// `style={{ color: 'red' }}` : ni classe, ni hexadécimal, et pourtant une
// couleur en dur. Seule une valeur `var(--…)` est admise en style en ligne.
const STYLE_EN_LIGNE =
  /\b(?:backgroundColor|borderColor|border(?:Top|Right|Bottom|Left)Color|outlineColor|caretColor|textDecorationColor|color)\s*:\s*(?!var\()['"`]/

describe('aucune couleur en dur', () => {
  it('ne laisse aucune valeur hexadécimale hors de la définition des jetons', () => {
    expect(fautifs(FICHIERS_SANS_JETONS, (c) => /#[0-9a-fA-F]{3,8}\b/.test(c))).toEqual([])
  })

  it('ne laisse aucune classe de la palette Tailwind par défaut', () => {
    // Une classe `bg-slate-100` oubliée n'est pas une faute de goût : c'est
    // une couleur qu'on ne pourra ni changer ni thématiser.
    expect(fautifs(FICHIERS_SANS_JETONS, (c) => PALETTE_TAILWIND.test(c))).toEqual([])
  })

  it('ne laisse aucune couleur Tailwind sans suffixe numérique', () => {
    // `bg-black text-white` : « ce n'est pas une couleur de marque » — c'est
    // pourtant la seule paire que le préréglage Neutre ne pourra pas suivre.
    expect(fautifs(FICHIERS_SANS_JETONS, (c) => PALETTE_SANS_SUFFIXE.test(c))).toEqual([])
  })

  it('ne laisse aucune valeur arbitraire de couleur entre crochets', () => {
    expect(fautifs(FICHIERS_SANS_JETONS, (c) => VALEUR_ARBITRAIRE.test(c))).toEqual([])
  })

  it('ne laisse aucune fonction de couleur écrite en clair', () => {
    expect(fautifs(FICHIERS_SANS_JETONS, (c) => FONCTION_DE_COULEUR.test(c))).toEqual([])
  })

  it('ne laisse aucune couleur posée en style en ligne', () => {
    expect(fautifs(FICHIERS_SANS_JETONS, (c) => STYLE_EN_LIGNE.test(c))).toEqual([])
  })

  it('ne pose jamais de fond avec un jeton qui ne porte pas de texte', () => {
    // `accentDark` et `focus` sont déclarés dans les jetons comme ne portant
    // jamais de texte : `onAccent` sur `accentDark` tombe à 4,24:1. Ils sont
    // faits pour les contours et les anneaux ; un fond de bouton les remet
    // aussitôt sous une encre, et `findContrastIssues` ne regarde que des
    // couples déclarés, jamais un `className`.
    // `\b` avant `bg` : `hover:bg-accent-dark` est pris comme `bg-accent-dark`.
    const fond = /\bbg-(?:accent-dark|focus)\b/
    expect(fautifs(FICHIERS_SANS_JETONS, (c) => fond.test(sansCommentaires(c)))).toEqual([])
  })
})

/**
 * Le segment de chaîne qui entoure une position donnée : on remonte et on
 * descend jusqu'au premier délimiteur de chaîne (`'`, `"` ou backtick).
 *
 * C'est volontairement grossier, et volontairement pessimiste : une liste de
 * classes vit toujours dans une chaîne, et couper trop court ne peut que
 * *durcir* le contrôle, jamais le relâcher.
 */
function segmentAutour(contenu: string, position: number): string {
  const delimiteur = /['"`]/
  let debut = position
  while (debut > 0 && !delimiteur.test(contenu[debut - 1]!)) debut -= 1
  let fin = position
  while (fin < contenu.length && !delimiteur.test(contenu[fin]!)) fin += 1
  return contenu.slice(debut, fin)
}

/**
 * Un contour posé **sur l'état de focus**. `ring-focus` seul n'en est pas un :
 * c'est un anneau de la couleur de focus, que la grille utilise pour la
 * sélection à la souris. Seule la variante d'état compte.
 */
const CONTOUR_DE_FOCUS = /(?:focus|focus-visible):(?:outline|ring)/

describe('focus visible', () => {
  it('ne supprime le contour dans aucune liste de classes sans le remplacer sur place', () => {
    // Le contrôle porte sur la **liste de classes**, pas sur le fichier : un
    // `ring-focus` posé ailleurs dans le même fichier — sur un anneau de
    // sélection à la souris, par exemple — n'absout pas un `outline-none`.
    const coupables: string[] = []
    for (const chemin of FICHIERS) {
      const contenu = lit(chemin)
      for (const trouve of contenu.matchAll(/outline-none/g)) {
        const segment = segmentAutour(contenu, trouve.index)
        if (!CONTOUR_DE_FOCUS.test(segment)) {
          coupables.push(`${relative(RACINE, chemin)} :: ${segment.trim()}`)
        }
      }
    }
    expect(coupables).toEqual([])
  })

  it('ne neutralise le contour dans aucune feuille de style', () => {
    // `globals.css` porte la règle `:focus-visible` unique de l'application.
    // Un `outline: none` déclaré après elle la neutralise partout à la fois,
    // sans qu'aucune assertion de présence ne s'en aperçoive.
    const feuilles = FICHIERS.filter((chemin) => chemin.endsWith('.css'))
    expect(fautifs(feuilles, (c) => /outline(?:-\w+)?\s*:\s*(?:none|0)\b/.test(c))).toEqual([])
  })

  it('garde une règle de focus visible dans la feuille globale', () => {
    const css = lit(join(RACINE, 'app', 'globals.css'))
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline\s*:/)
  })
})

describe('cible tactile', () => {
  it('déclare 44 points sur les deux dimensions', () => {
    // Chercher « 2.75rem » quelque part dans la feuille laisserait passer une
    // hauteur ramenée à 1,5rem tant que la largeur reste bonne : les deux
    // déclarations se vérifient séparément, dans le bloc de l'utilitaire.
    const css = lit(join(RACINE, 'app', 'globals.css'))
    const bloc = /@utility\s+touch-target\s*\{([^}]*)\}/.exec(css)
    expect(bloc, '@utility touch-target introuvable').not.toBeNull()
    expect(bloc![1]).toMatch(/min-height:\s*2\.75rem/)
    expect(bloc![1]).toMatch(/min-width:\s*2\.75rem/)
  })
})
