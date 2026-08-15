import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const RACINE = join(process.cwd(), 'src')

// Les seuls endroits où une couleur a le droit d'être écrite en clair : la
// définition des jetons, et les tests qui la vérifient.
const EXEMPTS = [
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

const FICHIERS = sources(RACINE).filter(
  (chemin) => !EXEMPTS.some((exempt) => chemin.endsWith(exempt)),
)

const PALETTE_TAILWIND =
  /\b(?:bg|text|border|ring|from|via|to|decoration|outline|accent|fill|stroke|divide|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/

describe('aucune couleur en dur', () => {
  it('ne laisse aucune valeur hexadécimale hors de la définition des jetons', () => {
    const fautifs = FICHIERS.filter((chemin) =>
      /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(chemin, 'utf8')),
    ).map((chemin) => relative(RACINE, chemin))
    expect(fautifs).toEqual([])
  })

  it('ne laisse aucune classe de la palette Tailwind par défaut', () => {
    // Une classe `bg-slate-100` oubliée n'est pas une faute de goût : c'est
    // une couleur qu'on ne pourra ni changer ni thématiser.
    const fautifs = FICHIERS.filter((chemin) =>
      PALETTE_TAILWIND.test(readFileSync(chemin, 'utf8')),
    ).map((chemin) => relative(RACINE, chemin))
    expect(fautifs).toEqual([])
  })
})

describe('focus visible', () => {
  it('ne supprime nulle part le contour sans le remplacer', () => {
    const fautifs = FICHIERS.filter((chemin) => {
      const contenu = readFileSync(chemin, 'utf8')
      const supprime = /outline-none|outline:\s*none/.test(contenu)
      const remplace = /focus-visible|ring-focus|outline-focus/.test(contenu)
      return supprime && !remplace
    }).map((chemin) => relative(RACINE, chemin))
    expect(fautifs).toEqual([])
  })
})
