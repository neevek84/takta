import { z } from 'zod'
import { prisma } from '@/db/client'
import { readSettingsRow } from './settings'
import {
  DEFAULT_THEME,
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
  describeContrastIssue,
  findContrastIssues,
  type ThemeTokens,
} from '@/core/theme/tokens'

// --- Thème -------------------------------------------------------------
//
// Le thème vit dans la même ligne singleton que les réglages, en JSON lu et
// écrit en bloc — comme `slotsJson`/`holidaysJson` de `settings.ts`, et pour
// la même raison : la portabilité SQLite/Postgres interdit les tableaux et
// les requêtes fines sur du JSON. La ligne elle-même n'est jamais créée ici :
// `readSettingsRow` en est le seul propriétaire (voir son commentaire — deux
// créations jumelles avaient déjà divergé).
//
// Exception documentée à la règle du projet : `getTheme` et `updateTheme` ne
// prennent pas de `userId`. Le thème est un réglage d'instance, porté par la
// ligne singleton `Settings`, exactement comme `getSettings`.
//
// Même règle de validation que pour le reste des réglages : le service est
// la seule barrière qui compte. L'écran de thème ne juge rien, il transcrit
// et affiche. Un futur endpoint API, un script de reprise ou une requête
// forgée passent par ici.

function hexSchema(label: string): z.ZodString {
  return z
    .string({ message: `La couleur « ${label} » est requise.` })
    .regex(/^#[0-9a-f]{6}$/i, `La couleur « ${label} » doit s’écrire #RRGGBB.`)
}

// `z.object` attend un objet de schémas ; le construire depuis la liste des
// jetons évite d'écrire 26 lignes qui pourraient diverger du type.
const themeSchema = z.object(
  Object.fromEntries(
    THEME_TOKEN_KEYS.map((key) => [key, hexSchema(TOKEN_LABELS[key])]),
  ) as Record<keyof ThemeTokens, z.ZodString>,
)

export class ThemeValidationError extends Error {
  errors: string[]

  constructor(errors: string[]) {
    super(errors.join(' '))
    this.name = 'ThemeValidationError'
    this.errors = errors
  }
}

/**
 * Valide une palette sans l'écrire : forme d'abord, contraste ensuite.
 * Un couple sous le seuil est un refus, pas un avertissement — offrir un
 * thème sans cette barrière reviendrait à offrir le moyen de rendre
 * l'application illisible.
 */
export function validateTheme(
  input: unknown,
): { ok: true; theme: ThemeTokens } | { ok: false; errors: string[] } {
  const parsed = themeSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: [...new Set(parsed.error.issues.map((i) => i.message))] }
  }

  const theme = normaliseTheme(parsed.data as ThemeTokens)
  const issues = findContrastIssues(theme)
  if (issues.length > 0) {
    return { ok: false, errors: issues.map(describeContrastIssue) }
  }

  return { ok: true, theme }
}

/** Les couleurs sont comparées entre elles : une seule casse, la minuscule. */
function normaliseTheme(theme: ThemeTokens): ThemeTokens {
  const out = {} as ThemeTokens
  for (const key of THEME_TOKEN_KEYS) out[key] = theme[key].toLowerCase()
  return out
}

/**
 * Lecture en bloc, tolérante par construction : le défaut comble ce qui
 * manque, une colonne illisible retombe entièrement sur lui. Un thème est un
 * habillage — refuser de rendre l'application parce qu'une couleur est
 * corrompue serait un remède pire que le mal. La ligne n'est jamais réécrite
 * en douce : seul `updateTheme` écrit, et lui valide.
 *
 * La tolérance s'arrête au *contenu* de la colonne : un appel qui jette
 * (base injoignable, colonne absente) est du ressort de l'appelant, et le
 * layout racine s'en protège.
 */
export async function getTheme(): Promise<ThemeTokens> {
  const { themeJson } = await readSettingsRow()

  let brut: unknown
  try {
    brut = JSON.parse(themeJson)
  } catch {
    return DEFAULT_THEME
  }

  if (typeof brut !== 'object' || brut === null) return DEFAULT_THEME
  const stocke = brut as Record<string, unknown>

  const theme = {} as ThemeTokens
  for (const key of THEME_TOKEN_KEYS) {
    const valeur = stocke[key]
    theme[key] =
      typeof valeur === 'string' && /^#[0-9a-f]{6}$/i.test(valeur)
        ? valeur.toLowerCase()
        : DEFAULT_THEME[key]
  }
  return theme
}

export async function updateTheme(input: unknown): Promise<ThemeTokens> {
  const verdict = validateTheme(input)
  if (!verdict.ok) throw new ThemeValidationError(verdict.errors)

  await readSettingsRow() // garantit l'existence du singleton

  await prisma.settings.update({
    where: { id: 'singleton' },
    // En bloc : jamais une requête sur une clé du JSON, portabilité oblige.
    data: { themeJson: JSON.stringify(verdict.theme) },
  })

  return verdict.theme
}

export async function resetTheme(): Promise<ThemeTokens> {
  return updateTheme(DEFAULT_THEME)
}
