import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NEUTRE_AVANT_1G_CLAIR, NEUTRE_AVANT_1G_SOMBRE, NEUTRE_LOT_1E } from './reprise'
import { THEME_ENCRE_CLAIR, THEME_ENCRE_SOMBRE, THEME_TOKEN_KEYS } from './tokens'
import type { ThemeTokens } from './tokens'

/**
 * Le script de reprise **recopie** la règle du module : un script ESM ne peut
 * pas importer du TypeScript sans outillage, contrainte que
 * `backfill-heures-saisies.mjs` documente déjà.
 *
 * Une recopie non surveillée dérive. Ce fichier lit la source du script et
 * confronte ses quatre palettes à celles qui font foi : le jour où un jeton
 * change d'un côté sans l'autre, c'est ici que ça tombe — et pas en production,
 * sur une palette à moitié reprise.
 */
const SCRIPT = readFileSync(join(process.cwd(), 'scripts', 'migrer-theme-encre.mjs'), 'utf8')

/** Lit un littéral objet JSON déclaré en `const NOM = { … }` dans le script. */
function paletteDuScript(nom: string): Record<string, string> {
  const debut = SCRIPT.indexOf(`const ${nom} = {`)
  expect(debut, `le script ne déclare pas ${nom}`).toBeGreaterThan(-1)
  const ouvrante = SCRIPT.indexOf('{', debut)
  const fermante = SCRIPT.indexOf('\n}', ouvrante)
  return JSON.parse(SCRIPT.slice(ouvrante, fermante + 2)) as Record<string, string>
}

function enObjet(tokens: ThemeTokens): Record<string, string> {
  return Object.fromEntries(THEME_TOKEN_KEYS.map((k) => [k, tokens[k]]))
}

describe('le script de reprise ne dérive pas du module', () => {
  it('ne recopie PAS les palettes historiques : il lit le même JSON que le module', () => {
    // La recopie la moins risquée est celle qui n'existe pas. Les trois
    // défauts historiques sont des données, lues par les deux côtés dans
    // `palettes-historiques.json` — aucune dérive n'est possible sur eux.
    expect(SCRIPT).toContain("palettes-historiques.json")
    expect(SCRIPT).not.toMatch(/const NEUTRE_LOT_1E = \{/)
    expect(SCRIPT).not.toMatch(/const NEUTRE_AVANT_1G_CLAIR = \{/)
    // Et le module lit bien le même fichier, sinon les deux liraient deux
    // vérités différentes en croyant n'en lire qu'une.
    expect(Object.keys(NEUTRE_LOT_1E)).toHaveLength(44)
    expect(Object.keys(NEUTRE_AVANT_1G_CLAIR)).toHaveLength(44)
    expect(Object.keys(NEUTRE_AVANT_1G_SOMBRE)).toHaveLength(44)
  })

  it('recopie exactement les deux palettes d’arrivée', () => {
    expect(paletteDuScript('ENCRE_CLAIR')).toEqual(enObjet(THEME_ENCRE_CLAIR))
    expect(paletteDuScript('ENCRE_SOMBRE')).toEqual(enObjet(THEME_ENCRE_SOMBRE))
  })

  it('écrit une palette complète : tous les jetons du type, aucun oublié', () => {
    // Une palette d'arrivée incomplète ne casserait rien à la lecture — le
    // service comble les trous avec le défaut — mais elle enregistrerait un
    // panachage silencieux que plus personne ne saurait expliquer.
    for (const nom of ['ENCRE_CLAIR', 'ENCRE_SOMBRE']) {
      expect(Object.keys(paletteDuScript(nom)).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
    }
  })

  it('n’écrit jamais sans avoir reconnu le défaut : le seul `update` est sous `REPRISE`', () => {
    // Le garde-fou qui compte. Un script de reprise qui écrit hors de sa
    // condition écrase une décision de l'exploitant, et c'est irrattrapable :
    // la palette précédente n'est stockée nulle part.
    const update = SCRIPT.indexOf('prisma.settings.update')
    const garde = SCRIPT.indexOf("verdict.kind === 'REPRISE'")
    expect(garde).toBeGreaterThan(-1)
    expect(update).toBeGreaterThan(garde)
    expect(SCRIPT.match(/prisma\.settings\.update/g)).toHaveLength(1)
  })
})
