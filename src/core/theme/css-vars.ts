import { THEME_TOKEN_KEYS, type ThemeTokens } from './tokens'

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
