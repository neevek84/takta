import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * La frontière client / serveur, tenue par un contrôle et non par la vigilance.
 *
 * Le symptôme, constaté en ouvrant « Règles de saisie » :
 *
 *     Module build failed: UnhandledSchemeError:
 *     Reading from "node:crypto" is not handled by plugins.
 *
 * La cause n'était pas dans l'écran fautif. `SettingsForm` est un composant
 * client, et il importait **une valeur** — `ENGAGEMENT_SOURCES` — depuis
 * `@/services/settings`. Un `import type` disparaît à la compilation ; un
 * import de valeur, non : il tire tout le module dans le paquet client. Le
 * jour où le lot 4 a donné à ce service une dépendance vers l'audit, donc vers
 * `node:crypto`, l'écran a cessé de se construire — sans qu'aucune ligne de
 * cet écran n'ait changé.
 *
 * C'est la forme la plus coûteuse de panne : la faute et son effet sont dans
 * deux fichiers que rien ne relie à la lecture, et elle ne se voit qu'en
 * ouvrant la page. Aucun test ne la voyait, `tsc` non plus — le type est
 * parfaitement valide.
 *
 * Ce contrôle la rend impossible à réintroduire.
 */
const RACINE = join(process.cwd(), 'src')

function sources(dossier: string): string[] {
  const out: string[] = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    const chemin = join(dossier, entree.name)
    if (entree.isDirectory()) out.push(...sources(chemin))
    else if (/\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) {
      out.push(chemin)
    }
  }
  return out
}

const FICHIERS = sources(RACINE)

/** Un composant client : la directive doit être la première instruction. */
function estClient(contenu: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*['"]use client['"]/.test(contenu)
}

/**
 * Les imports de **valeur** d'un module, `import type` exclus.
 *
 * `import type { X } from '…'` et `import { type X } from '…'` sont effacés à
 * la compilation : ils ne pèsent rien sur le paquet, et un composant client a
 * parfaitement le droit de nommer le type que le serveur lui passe en prop.
 * Seul un import qui survit à la compilation compte ici.
 */
function importsDeValeur(contenu: string): string[] {
  const sources: string[] = []
  for (const trouve of contenu.matchAll(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    const clause = trouve[1]!
    const module = trouve[2]!
    if (/^type\s/.test(clause)) continue
    // `import { type A, type B } from '…'` : tout est effacé, rien ne reste.
    const accolades = /^\{([\s\S]*)\}$/.exec(clause.trim())
    if (accolades !== null) {
      const noms = accolades[1]!.split(',').map((n) => n.trim()).filter((n) => n.length > 0)
      if (noms.length > 0 && noms.every((n) => /^type\s/.test(n))) continue
    }
    sources.push(module)
  }
  return sources
}

describe('frontière client / serveur', () => {
  it('n’importe aucune VALEUR d’un service depuis un composant client', () => {
    // `services/` parle à Prisma, à l'audit, au chiffrement. Un composant
    // client peut en nommer les *types* — c'est la façon normale de typer une
    // prop — mais jamais en tirer une valeur : le paquet client emporterait
    // alors la base de données et `node:crypto` avec.
    const coupables: string[] = []
    for (const chemin of FICHIERS) {
      const contenu = readFileSync(chemin, 'utf8')
      if (!estClient(contenu)) continue
      for (const module of importsDeValeur(contenu)) {
        if (module.startsWith('@/services/') || module.startsWith('@/db/')) {
          coupables.push(`${relative(RACINE, chemin)} :: import de valeur depuis ${module}`)
        }
      }
    }
    expect(coupables).toEqual([])
  })

  it('ne laisse `node:crypto` que dans des modules purs, jamais dans un composant', () => {
    // Le contrôle du dessus attrape le chemin indirect. Celui-ci attrape le
    // direct, qui n'existe pas aujourd'hui et qui coûterait la même panne.
    const coupables: string[] = []
    for (const chemin of FICHIERS) {
      const contenu = readFileSync(chemin, 'utf8')
      if (!estClient(contenu)) continue
      if (/from\s+['"]node:/.test(contenu)) {
        coupables.push(relative(RACINE, chemin))
      }
    }
    expect(coupables).toEqual([])
  })

  it('sait reconnaître un composant client et distinguer type et valeur', () => {
    // Sans cette vérification, les deux contrôles ci-dessus passeraient tout
    // aussi bien en ne reconnaissant jamais aucun composant client — le
    // piège exact que ce projet a payé vingt fois.
    expect(estClient("'use client'\nimport x from 'y'")).toBe(true)
    expect(estClient("// un commentaire\n'use client'\n")).toBe(true)
    expect(estClient("import x from 'y'\n'use client'")).toBe(false)

    expect(importsDeValeur("import type { A } from '@/services/x'")).toEqual([])
    expect(importsDeValeur("import { type A } from '@/services/x'")).toEqual([])
    expect(importsDeValeur("import { A } from '@/services/x'")).toEqual(['@/services/x'])
    expect(importsDeValeur("import { type A, B } from '@/services/x'")).toEqual(['@/services/x'])

    // Et il existe bien des composants client à contrôler : un balayage qui
    // n'en trouverait aucun serait vert pour la pire des raisons.
    const clients = FICHIERS.filter((c) => estClient(readFileSync(c, 'utf8')))
    expect(clients.length).toBeGreaterThan(5)
  })
})

/**
 * Une directive placée ailleurs qu'en tête ne dit rien, et **ne casse que la
 * construction**.
 *
 * `next build` refuse par « The "use server" directive must be at the top of the
 * file ». Ni `tsc` ni la suite ne le voient : le module compile parfaitement, et
 * les tests qui l'emploient le simulent. Le défaut ne se manifeste donc qu'au
 * bout de la chaîne — pour nous, dans une construction d'image qui a échoué
 * après avoir été étiquetée.
 *
 * Mesuré le 22 août 2026 sur `src/app/(auth)/login/actions.ts`, où un import
 * avait été ajouté **au-dessus** du `'use server'`.
 */
describe('les directives de frontière sont en tête de fichier', () => {
  /**
   * La directive de **portée module** est-elle ailleurs qu'en tête ?
   *
   * Seule celle-là est concernée : `'use server'` **indenté**, à l'intérieur
   * d'une fonction, déclare une action en ligne et se place où il veut —
   * `src/app/(app)/layout.tsx` en porte une, légitimement.
   */
  function directiveMalPlacee(contenu: string, directive: string): boolean {
    const lignes = contenu.split('\n')
    const auModule = lignes.findIndex((l) => new RegExp(`^['"]${directive}['"]`).test(l))
    if (auModule === -1) return false

    // La première instruction du fichier, commentaires et lignes vides exclus.
    let premiere = 0
    let dansBloc = false
    for (; premiere < lignes.length; premiere++) {
      const l = (lignes[premiere] ?? '').trim()
      if (dansBloc) {
        if (l.includes('*/')) dansBloc = false
        continue
      }
      if (l === '' || l.startsWith('//')) continue
      if (l.startsWith('/*')) {
        if (!l.includes('*/')) dansBloc = true
        continue
      }
      break
    }

    return auModule !== premiere
  }

  it.each(['use server', 'use client'])('« %s » n est jamais précédé de code', (directive) => {
    const coupables: string[] = []

    for (const chemin of FICHIERS) {
      const contenu = readFileSync(chemin, 'utf8')
      if (directiveMalPlacee(contenu, directive)) {
        coupables.push(relative(RACINE, chemin))
      }
    }

    expect(
      coupables,
      `${coupables.join(', ')} : la directive « ${directive} » doit être la première instruction`,
    ).toEqual([])
  })
})

