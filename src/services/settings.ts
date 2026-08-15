import { z } from 'zod'
import { prisma } from '@/db/client'
import type { Slot } from '@/core/time/slots'
import { CAPACITY_MODES, DISPLAY_UNITS } from '@/core/types'
import type { CapacityMode, DisplayUnit, EngagementSource } from '@/core/types'
import { frenchHolidays } from '@/core/calendar/holidays-fr'
import {
  DEFAULT_THEME,
  THEME_TOKEN_KEYS,
  TOKEN_LABELS,
  describeContrastIssue,
  findContrastIssues,
  type ThemeTokens,
} from '@/core/theme/tokens'

export const DEFAULT_SLOTS: Slot[] = [
  { id: 'matin', label: 'Matin', startMinute: 540, endMinute: 780, centiemes: 50 },
  { id: 'apres-midi', label: 'Après-midi', startMinute: 840, endMinute: 1080, centiemes: 50 },
  { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 },
]

// `core/types.ts` n'expose pas de tableau des valeurs pour `EngagementSource`
// (contrairement à `CAPACITY_MODES` / `DISPLAY_UNITS`) — il est déclaré ici,
// côté service, pour la validation.
export const ENGAGEMENT_SOURCES: readonly EngagementSource[] = [
  'MANUEL',
  'DOLIBARR_PROPALE',
  'DOLIBARR_PROJET',
]

// --- Validation ------------------------------------------------------------
//
// Le serveur est la seule barrière qui compte : `required`/`min` côté HTML
// n'empêchent rien (formulaire vidé, requête forgée, futur appelant API).
// Chaque réglage est donc validé ici, dans le service, avant toute écriture.

const slotSchema = z.object({
  id: z.string().trim().min(1, 'Chaque créneau doit avoir un identifiant.'),
  label: z.string().trim().min(1, 'Chaque créneau doit avoir un libellé.'),
  startMinute: z
    .number({ message: "L'heure de début d'un créneau est requise." })
    .int("L'heure de début d'un créneau doit être un nombre entier de minutes.")
    .min(0, "L'heure de début d'un créneau est invalide.")
    .max(1439, "L'heure de début d'un créneau est invalide."),
  // Une valeur de fin <= début est volontairement acceptée : le créneau
  // franchit alors minuit (ex. Nuit 22:00 → 06:00 = 1320 → 360). Voir
  // `crossesMidnight` dans `core/time/slots.ts`.
  endMinute: z
    .number({ message: "L'heure de fin d'un créneau est requise." })
    .int("L'heure de fin d'un créneau doit être un nombre entier de minutes.")
    .min(0, "L'heure de fin d'un créneau est invalide.")
    .max(1439, "L'heure de fin d'un créneau est invalide."),
  centiemes: z
    .number({ message: "La valeur d'un créneau est requise." })
    .int("La valeur d'un créneau doit être un nombre entier de centièmes de jour.")
    .positive("La valeur d'un créneau doit être strictement positive.")
    .max(100_000, "La valeur d'un créneau est excessive."),
})

const slotsSchema = z.array(slotSchema).superRefine((slots, ctx) => {
  const seen = new Set<string>()
  for (const slot of slots) {
    if (seen.has(slot.id)) {
      ctx.addIssue({
        code: 'custom',
        message: `L'identifiant de créneau « ${slot.id} » est utilisé plusieurs fois.`,
      })
    }
    seen.add(slot.id)
  }
})

const workingDaysSchema = z
  .array(
    z
      .number({ message: 'Un jour ouvré est invalide.' })
      .int('Un jour ouvré doit être un nombre entier.')
      .min(1, 'Un jour ouvré doit être compris entre 1 (lundi) et 7 (dimanche).')
      .max(7, 'Un jour ouvré doit être compris entre 1 (lundi) et 7 (dimanche).'),
  )
  .superRefine((days, ctx) => {
    if (new Set(days).size !== days.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Un même jour ouvré ne peut pas être sélectionné plusieurs fois.',
      })
    }
  })

const settingsPatchSchema = z
  .object({
    // Strictement positif et plafonné à une journée réelle : en dessous
    // de 60 min, `centiemesToMinutes` et `parseQuantity` produisent des
    // arrondis à 0 qui font disparaître silencieusement toute saisie (voir
    // revue finale, C4).
    minutesParJour: z
      .number({ message: "La durée d'une journée est requise." })
      .int("La durée d'une journée doit être un nombre entier de minutes.")
      .min(60, "La durée d'une journée doit être d'au moins 1 heure (60 minutes).")
      .max(1440, "La durée d'une journée ne peut pas dépasser 24 heures (1440 minutes)."),
    capacityMode: z.enum(CAPACITY_MODES as [CapacityMode, ...CapacityMode[]], {
      message: 'Le mode de contrôle de capacité est invalide.',
    }),
    capacityCentiemes: z
      .number({ message: 'Le seuil de capacité est requis.' })
      .int('Le seuil de capacité doit être un nombre entier de centièmes de jour.')
      .positive('Le seuil de capacité doit être strictement positif.')
      .max(100_000, 'Le seuil de capacité est excessif.'),
    workingDays: workingDaysSchema,
    slots: slotsSchema,
    holidays: z.array(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Une date de jour férié est invalide (format AAAA-MM-JJ attendu).'),
    ),
    defaultDisplayUnit: z.enum(DISPLAY_UNITS as [DisplayUnit, ...DisplayUnit[]], {
      message: "L'unité d'affichage par défaut est invalide.",
    }),
    defaultEngagementSource: z.enum(ENGAGEMENT_SOURCES as [EngagementSource, ...EngagementSource[]], {
      message: "La source d'engagement par défaut est invalide.",
    }),
    objectifCaExerciceCents: z
      .number()
      .int("L'objectif de chiffre d'affaires doit être un entier de centimes.")
      .min(0, "L'objectif de chiffre d'affaires ne peut pas être négatif."),
    debutExerciceMois: z
      .number()
      .int('Le mois de début d’exercice doit être un entier.')
      .min(1, 'Le mois de début d’exercice doit être compris entre 1 et 12.')
      .max(12, 'Le mois de début d’exercice doit être compris entre 1 et 12.'),
  })
  .partial()

/**
 * Valide un patch de réglages sans l'appliquer. Utilisé par `updateSettings`
 * (garde en profondeur) et par les server actions, pour renvoyer des
 * messages d'erreur en français exploitables par l'UI plutôt que de laisser
 * l'erreur se perdre dans une exception non gérée.
 */
export function validateSettingsPatch(
  patch: Partial<AppSettings>,
): { ok: true } | { ok: false; errors: string[] } {
  const result = settingsPatchSchema.safeParse(patch)
  if (result.success) return { ok: true }
  const errors = [...new Set(result.error.issues.map((issue) => issue.message))]
  return { ok: false, errors }
}

export interface AppSettings {
  minutesParJour: number
  capacityMode: CapacityMode
  capacityCentiemes: number
  workingDays: number[]
  slots: Slot[]
  /** dates ISO 'YYYY-MM-DD' */
  holidays: string[]
  defaultDisplayUnit: DisplayUnit
  defaultEngagementSource: EngagementSource
  /** objectif de CA sur l'exercice, en centimes. 0 = non défini. */
  objectifCaExerciceCents: number
  /** mois de début d'exercice, 1-12 */
  debutExerciceMois: number
}

function parseDays(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
}

type Row = Awaited<ReturnType<typeof prisma.settings.upsert>>

function toAppSettings(row: Row): AppSettings {
  const slots = JSON.parse(row.slotsJson) as Slot[]
  return {
    minutesParJour: row.minutesParJour,
    capacityMode: row.capacityMode as CapacityMode,
    capacityCentiemes: row.capacityCentiemes,
    workingDays: parseDays(row.workingDays),
    slots: slots.length > 0 ? slots : DEFAULT_SLOTS,
    holidays: JSON.parse(row.holidaysJson) as string[],
    defaultDisplayUnit: row.defaultDisplayUnit as DisplayUnit,
    defaultEngagementSource: row.defaultEngagementSource as EngagementSource,
    objectifCaExerciceCents: row.objectifCaExerciceCents,
    debutExerciceMois: row.debutExerciceMois,
  }
}

export async function getSettings(): Promise<AppSettings> {
  const row = await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', slotsJson: JSON.stringify(DEFAULT_SLOTS) },
    update: {},
  })
  return toAppSettings(row)
}

export class SettingsValidationError extends Error {
  errors: string[]

  constructor(errors: string[]) {
    super(errors.join(' '))
    this.name = 'SettingsValidationError'
    this.errors = errors
  }
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  // Garde en profondeur : le service est la seule barrière qui compte, pas
  // le formulaire qui l'appelle. Aucun appelant (server action actuelle,
  // futur endpoint API, script de reprise) ne peut donc persister un
  // réglage aberrant en contournant la validation d'un écran particulier.
  const validation = validateSettingsPatch(patch)
  if (!validation.ok) {
    throw new SettingsValidationError(validation.errors)
  }

  await getSettings() // garantit l'existence du singleton

  const row = await prisma.settings.update({
    where: { id: 'singleton' },
    data: {
      ...(patch.minutesParJour !== undefined && { minutesParJour: patch.minutesParJour }),
      ...(patch.capacityMode !== undefined && { capacityMode: patch.capacityMode }),
      ...(patch.capacityCentiemes !== undefined && { capacityCentiemes: patch.capacityCentiemes }),
      ...(patch.workingDays !== undefined && { workingDays: patch.workingDays.join(',') }),
      ...(patch.slots !== undefined && { slotsJson: JSON.stringify(patch.slots) }),
      ...(patch.holidays !== undefined && { holidaysJson: JSON.stringify(patch.holidays) }),
      ...(patch.defaultDisplayUnit !== undefined && { defaultDisplayUnit: patch.defaultDisplayUnit }),
      ...(patch.defaultEngagementSource !== undefined && {
        defaultEngagementSource: patch.defaultEngagementSource,
      }),
      ...(patch.objectifCaExerciceCents !== undefined && {
        objectifCaExerciceCents: patch.objectifCaExerciceCents,
      }),
      ...(patch.debutExerciceMois !== undefined && { debutExerciceMois: patch.debutExerciceMois }),
    },
  })
  return toAppSettings(row)
}

/** Recharge les fériés français sur une plage d'années, en remplaçant les existants. */
export async function loadFrenchHolidays(fromYear: number, toYear: number): Promise<AppSettings> {
  const dates: string[] = []
  for (let y = fromYear; y <= toYear; y++) {
    dates.push(...frenchHolidays(y).map((h) => h.date))
  }
  return updateSettings({ holidays: dates })
}

// --- Thème -------------------------------------------------------------
//
// Le thème vit dans la même ligne singleton, en JSON lu et écrit en bloc —
// comme `slotsJson`/`holidaysJson` ci-dessus, et pour la même raison : la
// portabilité SQLite/Postgres interdit les tableaux et les requêtes fines
// sur du JSON. Exception documentée à la règle du projet : `getTheme` et
// `updateTheme` ne prennent pas de `userId`. Le thème est un réglage
// d'instance, porté par la ligne singleton `Settings`, exactement comme
// `getSettings`.
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

async function readThemeRow(): Promise<{ themeJson: string }> {
  const row = await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
    select: { themeJson: true },
  })
  return row
}

/**
 * Lecture en bloc, tolérante par construction : le défaut comble ce qui
 * manque, une colonne illisible retombe entièrement sur lui. Un thème est un
 * habillage — refuser de rendre l'application parce qu'une couleur est
 * corrompue serait un remède pire que le mal. La ligne n'est jamais réécrite
 * en douce : seul `updateTheme` écrit, et lui valide.
 */
export async function getTheme(): Promise<ThemeTokens> {
  const { themeJson } = await readThemeRow()

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

  await readThemeRow() // garantit l'existence du singleton

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
