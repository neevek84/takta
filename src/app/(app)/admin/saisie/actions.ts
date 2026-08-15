'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { updateSettings, loadFrenchHolidays, SettingsValidationError } from '@/services/settings'
import type { CapacityMode, DisplayUnit, EngagementSource } from '@/core/types'
import type { Slot } from '@/core/time/slots'

export type SaveSettingsState = { ok: true } | { ok: false; errors: string[] } | null

function parseSlotsField(raw: FormDataEntryValue | null): Slot[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed as Slot[]
  } catch {
    return null
  }
}

/**
 * Server action du formulaire de réglages. Signature à deux arguments
 * (compatible `useActionState`) pour pouvoir renvoyer les messages
 * d'erreur — en français — jusqu'au formulaire au lieu de les laisser se
 * perdre dans une exception non affichée (revue finale, C4).
 *
 * La validation qui compte réellement vit dans `updateSettings` (couche
 * service) : cette action ne fait que transcrire le FormData et relayer le
 * verdict, elle ne revalide rien elle-même.
 */
export async function saveSettings(
  _prevState: SaveSettingsState,
  formData: FormData,
): Promise<SaveSettingsState> {
  await requireUser()

  const heures = Number(formData.get('heures'))
  const minutesSup = Number(formData.get('minutes'))
  const slots = parseSlotsField(formData.get('slotsJson'))

  if (slots === null) {
    return {
      ok: false,
      errors: ['La liste des créneaux est illisible ; rechargez la page et réessayez.'],
    }
  }

  try {
    await updateSettings({
      minutesParJour: heures * 60 + minutesSup,
      capacityMode: String(formData.get('capacityMode')) as CapacityMode,
      capacityCentiemes: Math.round(Number(formData.get('capaciteJours')) * 100),
      workingDays: formData.getAll('workingDays').map((d) => Number(d)),
      slots,
      defaultDisplayUnit: String(formData.get('defaultDisplayUnit')) as DisplayUnit,
      defaultEngagementSource: String(formData.get('defaultEngagementSource')) as EngagementSource,
    })
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      return { ok: false, errors: err.errors }
    }
    throw err
  }

  revalidatePath('/admin/saisie')
  return { ok: true }
}

export async function reloadHolidays() {
  await requireUser()
  const y = new Date().getUTCFullYear()
  await loadFrenchHolidays(y - 1, y + 2)
  revalidatePath('/admin/saisie')
}
