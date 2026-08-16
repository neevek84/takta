import { THEME_TOKEN_KEYS, type ThemeConfig, type ThemeTokens } from './tokens'

/** `accentDark` → `--color-accent-dark`, le nom que Tailwind attend pour `bg-accent-dark`. */
export function cssVarName(key: keyof ThemeTokens): string {
  return `--color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

/**
 * Palette prête à poser en `style` sur `<html>`. Les variables ainsi injectées
 * l'emportent sur celles de `@layer theme`, sans `!important` : c'est ce qui
 * rend un thème enregistré immédiat, sans reconstruction.
 */
export function themeToCssVars(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const key of THEME_TOKEN_KEYS) {
    vars[cssVarName(key)] = tokens[key]
  }
  return vars
}

/**
 * Seule forme qu'une valeur a le droit de prendre dans la feuille injectée.
 * Le service valide déjà, et `getTheme` répare ce qu'il lit ; ce filtre est la
 * troisième barrière, celle qui compte : le texte produit ici part dans un
 * `<style>` posé tel quel dans la page. Une valeur hors forme n'est pas
 * corrigée, elle est **omise** — la déclaration de `globals.css` reprend alors
 * la main, ce qui est toujours une couleur lisible.
 */
const HEX_SIX = /^#[0-9a-fA-F]{6}$/

function declarations(tokens: ThemeTokens): string {
  const out: string[] = []
  for (const key of THEME_TOKEN_KEYS) {
    const valeur = tokens[key]
    if (typeof valeur === 'string' && HEX_SIX.test(valeur)) {
      out.push(`${cssVarName(key)}:${valeur};`)
    }
  }
  return out.join('')
}

/**
 * Sélecteur volontairement redondant. `html:root` désigne le même élément que
 * `:root` mais avec une spécificité de 2 au lieu de 1, et cette règle-ci n'est
 * dans **aucune couche** — Tailwind pose les valeurs d'`@theme` dans
 * `@layer theme`, et une déclaration hors couche l'emporte sur toute
 * déclaration en couche. Les deux mécanismes disent la même chose ; si l'un
 * venait à changer, l'autre tient encore.
 */
const RACINE = 'html:root'

/**
 * La feuille de thème, prête à poser dans un `<style>`.
 *
 * C'est ce qui remplace les variables jadis posées en attribut `style` sur
 * `<html>` : un attribut ne peut pas porter de requête média, et sans requête
 * média il n'y a pas de « suivre la préférence du système » sans JavaScript —
 * donc pas sans scintillement au chargement.
 *
 * - `systeme` : la palette claire s'applique, et `prefers-color-scheme: dark`
 *   la remplace. `color-scheme: light dark` accorde en même temps les éléments
 *   que la page ne peint pas elle-même — barres de défilement, sélecteurs de
 *   couleur, champs natifs.
 * - `clair` / `sombre` : une seule palette, sans requête média. Le choix
 *   explicite l'emporte, y compris sur un poste réglé à l'inverse.
 */
export function themeStylesheet(config: ThemeConfig): string {
  if (config.mode === 'clair') {
    return `${RACINE}{color-scheme:light;${declarations(config.clair)}}`
  }
  if (config.mode === 'sombre') {
    return `${RACINE}{color-scheme:dark;${declarations(config.sombre)}}`
  }
  return (
    `${RACINE}{color-scheme:light dark;${declarations(config.clair)}}` +
    `@media (prefers-color-scheme:dark){${RACINE}{color-scheme:dark;${declarations(config.sombre)}}}`
  )
}
