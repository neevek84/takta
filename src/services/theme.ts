import { z } from 'zod'
import { prisma } from '@/db/client'
import { readSettingsRow } from './settings'
import {
  DEFAULT_THEME,
  DEFAULT_THEME_CONFIG,
  THEME_MODES,
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
  describeContrastIssue,
  findConfigIssues,
  type ThemeConfig,
  type ThemeMode,
  type ThemeNature,
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
// Exception documentée à la règle du projet : `getThemeConfig` et
// `updateThemeConfig` ne prennent pas de `userId`. Le thème est un réglage
// d'instance, porté par la ligne singleton `Settings`, exactement comme
// `getSettings`. La spec du lot 1f écarte explicitement un thème par
// utilisateur (§7) : ce qui reste propre à chaque poste, c'est la seule
// préférence du système, et elle est lue par le navigateur, pas par nous.
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

const configSchema = z.object({
  mode: z.enum(THEME_MODES, {
    message: 'Le mode de thème doit être « systeme », « clair » ou « sombre ».',
  }),
  clair: themeSchema,
  sombre: themeSchema,
})

/** « Thème clair » / « Thème sombre », pour nommer le versant dans un refus. */
const NOM_VERSANT: Record<ThemeNature, string> = {
  clair: 'Thème clair',
  sombre: 'Thème sombre',
}

/**
 * Valide une configuration sans l'écrire : forme d'abord, contraste ensuite,
 * et sur **les deux palettes**. Un couple sous le seuil est un refus, pas un
 * avertissement — offrir un thème sans cette barrière reviendrait à offrir le
 * moyen de rendre l'application illisible, et l'offrir sur une seule des deux
 * palettes reviendrait à ne la protéger qu'une fois sur deux.
 */
export function validateThemeConfig(
  input: unknown,
): { ok: true; config: ThemeConfig } | { ok: false; errors: string[] } {
  const parsed = configSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: [...new Set(parsed.error.issues.map((i) => i.message))] }
  }

  const config: ThemeConfig = {
    mode: parsed.data.mode as ThemeMode,
    clair: normaliseTheme(parsed.data.clair as ThemeTokens),
    sombre: normaliseTheme(parsed.data.sombre as ThemeTokens),
  }

  const issues = findConfigIssues(config)
  if (issues.length > 0) {
    return {
      ok: false,
      // Sans le versant, un message nommerait un couple fautif sans dire
      // laquelle des deux palettes corriger.
      errors: issues.map(
        ({ palette, issue }) => `${NOM_VERSANT[palette]} — ${describeContrastIssue(issue)}`,
      ),
    }
  }

  return { ok: true, config }
}

/** Les couleurs sont comparées entre elles : une seule casse, la minuscule. */
function normaliseTheme(theme: ThemeTokens): ThemeTokens {
  const out = {} as ThemeTokens
  for (const key of THEME_TOKEN_KEYS) out[key] = theme[key].toLowerCase()
  return out
}

/**
 * Répare une palette lue : ce qui n'est pas une couleur bien formée retombe
 * sur le défaut *de son versant*. Combler un trou du sombre avec une valeur
 * claire produirait une palette panachée, illisible sans être invalide.
 */
function repareTheme(brut: unknown, defaut: ThemeTokens): ThemeTokens {
  const stocke =
    typeof brut === 'object' && brut !== null ? (brut as Record<string, unknown>) : {}
  const theme = {} as ThemeTokens
  for (const key of THEME_TOKEN_KEYS) {
    const valeur = stocke[key]
    theme[key] =
      typeof valeur === 'string' && /^#[0-9a-f]{6}$/i.test(valeur)
        ? valeur.toLowerCase()
        : defaut[key]
  }
  return theme
}

/**
 * Lecture en bloc, tolérante par construction : le défaut comble ce qui
 * manque, une colonne illisible retombe entièrement sur lui. Un thème est un
 * habillage — refuser de rendre l'application parce qu'une couleur est
 * corrompue serait un remède pire que le mal. La ligne n'est jamais réécrite
 * en douce : seul `updateThemeConfig` écrit, et lui valide.
 *
 * La tolérance s'arrête au *contenu* de la colonne : un appel qui jette
 * (base injoignable, colonne absente) est du ressort de l'appelant, et le
 * layout racine s'en protège.
 *
 * **Reprise du format du lot 1e** : la colonne y portait une palette unique,
 * à plat. Elle est relue comme la palette *claire* d'une configuration qui
 * suit la préférence du système, complétée par le sombre livré. Le porteur qui
 * avait enregistré sa palette de marque la retrouve donc telle quelle de jour,
 * et reçoit un sombre construit de nuit — ce qu'il a demandé. Rien n'est
 * réécrit en base : la reprise se refait à chaque lecture, jusqu'au prochain
 * enregistrement.
 */
export async function getThemeConfig(): Promise<ThemeConfig> {
  const { themeJson } = await readSettingsRow()

  let brut: unknown
  try {
    brut = JSON.parse(themeJson)
  } catch {
    return DEFAULT_THEME_CONFIG
  }

  if (typeof brut !== 'object' || brut === null) return DEFAULT_THEME_CONFIG
  const stocke = brut as Record<string, unknown>

  // Le format à plat du lot 1e : aucun versant nommé, mais des jetons à la
  // racine. Une colonne vide (`{}`) tombe ici aussi, et rend le défaut.
  const aDeuxVersants =
    typeof stocke.clair === 'object' && stocke.clair !== null &&
    typeof stocke.sombre === 'object' && stocke.sombre !== null

  if (!aDeuxVersants) {
    return {
      mode: DEFAULT_THEME_CONFIG.mode,
      clair: repareTheme(stocke, DEFAULT_THEME),
      // Le repli du sombre suit le défaut livré, comme celui du clair. Le
      // figer sur une palette nommée produisait un panachage silencieux le
      // jour où le défaut change de famille : Encre clair de jour, neutre
      // bleuté de nuit.
      sombre: DEFAULT_THEME_CONFIG.sombre,
    }
  }

  const mode = THEME_MODES.find((m) => m === stocke.mode) ?? DEFAULT_THEME_CONFIG.mode
  return {
    mode,
    clair: repareTheme(stocke.clair, DEFAULT_THEME),
    sombre: repareTheme(stocke.sombre, DEFAULT_THEME_CONFIG.sombre),
  }
}

export async function updateThemeConfig(input: unknown): Promise<ThemeConfig> {
  const verdict = validateThemeConfig(input)
  if (!verdict.ok) throw new ThemeValidationError(verdict.errors)

  await readSettingsRow() // garantit l'existence du singleton

  await prisma.settings.update({
    where: { id: 'singleton' },
    // En bloc : jamais une requête sur une clé du JSON, portabilité oblige.
    data: { themeJson: JSON.stringify(verdict.config) },
  })

  return verdict.config
}

export async function resetTheme(): Promise<ThemeConfig> {
  return updateThemeConfig(DEFAULT_THEME_CONFIG)
}
