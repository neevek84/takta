import { z } from 'zod'
import { prisma } from '@/db/client'
import type { Slot } from '@/core/time/slots'
import { CAPACITY_MODES, DISPLAY_UNITS } from '@/core/types'
import type { CapacityMode, DisplayUnit, EngagementSource } from '@/core/types'
import { frenchHolidays } from '@/core/calendar/holidays-fr'
import { appendAudit, actorOf } from './audit'

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
    journeeDebutMinute: z
      .number({ message: 'Le début de la plage journée est requis.' })
      .int('Le début de la plage journée doit être un nombre entier de minutes.')
      .min(0, 'Le début de la plage journée est invalide.')
      .max(1439, 'Le début de la plage journée est invalide.'),
    journeeFinMinute: z
      .number({ message: 'La fin de la plage journée est requise.' })
      .int('La fin de la plage journée doit être un nombre entier de minutes.')
      .min(1, 'La fin de la plage journée est invalide.')
      .max(1440, 'La fin de la plage journée est invalide.'),
  })
  .partial()
  // La plage journée ne franchit jamais minuit, contrairement à un créneau :
  // elle sert à borner un bloc d'agenda dans la journée qu'il décrit. La
  // vérification croisée ne s'applique que si le patch porte les deux bornes,
  // un patch partiel n'ayant rien à comparer.
  .superRefine((patch, ctx) => {
    if (
      patch.journeeDebutMinute !== undefined &&
      patch.journeeFinMinute !== undefined &&
      patch.journeeFinMinute <= patch.journeeDebutMinute
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'La fin de la plage journée doit être postérieure à son début.',
      })
    }
  })

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
  /** début de la plage journée, minutes depuis minuit */
  journeeDebutMinute: number
  /** fin de la plage journée, minutes depuis minuit */
  journeeFinMinute: number
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
    journeeDebutMinute: row.journeeDebutMinute,
    journeeFinMinute: row.journeeFinMinute,
  }
}

/**
 * Accès unique à la ligne singleton `Settings` — **le seul endroit du dépôt
 * qui porte ses valeurs de création**.
 *
 * Il a existé deux upserts jumeaux, celui-ci et celui du thème, et ils ont
 * divergé : le second créait la ligne avec `{ id: 'singleton' }` seul, sans
 * `slotsJson`. Comme le thème est lu par le layout racine, c'est lui qui
 * gagnait toujours la course à la création, et la base gardait durablement
 * `slotsJson = "[]"` — masqué à la lecture par le repli de `toAppSettings`,
 * mais bien présent pour tout lecteur direct de la colonne (script de
 * reprise, export, futur endpoint). Deux fonctions ne doivent plus jamais
 * pouvoir décrire différemment la même création : elles passent toutes par
 * ici, thème compris (`services/theme.ts`).
 */
export async function readSettingsRow(): Promise<Row> {
  return prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', slotsJson: JSON.stringify(DEFAULT_SLOTS) },
    update: {},
  })
}

export async function getSettings(): Promise<AppSettings> {
  return toAppSettings(await readSettingsRow())
}

export class SettingsValidationError extends Error {
  errors: string[]

  constructor(errors: string[]) {
    super(errors.join(' '))
    this.name = 'SettingsValidationError'
    this.errors = errors
  }
}

/**
 * Résumé du patch pour le journal : les scalaires tels quels, les listes
 * réduites à leur cardinal. Recopier soixante jours fériés à chaque
 * enregistrement noierait le journal sans rien apprendre à personne — et
 * `cles` suffit à dire ce qui a été touché.
 */
function resumePatch(patch: Partial<AppSettings>): Record<string, unknown> {
  const resume: Record<string, unknown> = { cles: Object.keys(patch) }
  for (const [cle, valeur] of Object.entries(patch)) {
    resume[cle] = Array.isArray(valeur) ? `${valeur.length} valeur(s)` : valeur
  }
  return resume
}

/**
 * `userId` optionnel, en dernière position : les réglages sont une écriture
 * d'instance, que des dizaines d'appels de test font sans utilisateur. Absent,
 * l'acte revient à `SYSTEME` ; la server action des réglages, elle, passe
 * toujours l'utilisateur réel.
 */
export async function updateSettings(
  patch: Partial<AppSettings>,
  userId?: string,
): Promise<AppSettings> {
  // Garde en profondeur : le service est la seule barrière qui compte, pas
  // le formulaire qui l'appelle. Aucun appelant (server action actuelle,
  // futur endpoint API, script de reprise) ne peut donc persister un
  // réglage aberrant en contournant la validation d'un écran particulier.
  const validation = validateSettingsPatch(patch)
  if (!validation.ok) {
    throw new SettingsValidationError(validation.errors)
  }

  await readSettingsRow() // garantit l'existence du singleton

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
      ...(patch.journeeDebutMinute !== undefined && {
        journeeDebutMinute: patch.journeeDebutMinute,
      }),
      ...(patch.journeeFinMinute !== undefined && { journeeFinMinute: patch.journeeFinMinute }),
    },
  })

  // Après l'écriture, et seulement si elle a eu lieu : la validation lève
  // au-dessus, un patch refusé ne laisse donc rien au journal.
  await appendAudit({
    ...(await actorOf(userId ?? '')),
    action: 'reglage.modifie',
    entityType: 'Settings',
    entityId: 'singleton',
    payload: resumePatch(patch),
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

