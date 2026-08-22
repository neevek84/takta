'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, exigerAdministration } from '@/auth'
import { updateSettings, loadFrenchHolidays, SettingsValidationError } from '@/services/settings'
import { recalibrateOpenMonths } from '@/services/rates'
import type { CapacityMode, DisplayUnit, EngagementSource } from '@/core/types'
import type { Slot } from '@/core/time/slots'

export type SaveSettingsState = { ok: true } | { ok: false; errors: string[] } | null

/** 'HH:MM' -> minutes depuis minuit. NaN si illisible : la validation du
 *  service refusera le patch avec un message en français. */
function timeInputToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return NaN
  return Number(match[1]) * 60 + Number(match[2])
}

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
  const user = await exigerAdministration()

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
      objectifCaExerciceCents: Math.round(Number(formData.get('objectifCaEuros')) * 100),
      debutExerciceMois: Number(formData.get('debutExerciceMois')),
      journeeDebutMinute: timeInputToMinutes(String(formData.get('journeeDebut') ?? '')),
      journeeFinMinute: timeInputToMinutes(String(formData.get('journeeFin') ?? '')),
      // Le fuseau vit désormais ici et non dans `CRA_TIMEZONE`. Un champ vidé
      // est refusé par le service : « vide » signifie « jamais choisi », et
      // l'écrire rendrait ce sens indiscernable d'un choix délibéré.
      timeZone: String(formData.get('timeZone') ?? ''),
    },
    // Le journal de preuve nomme l'auteur du réglage : un acte humain
    // attribué à `SYSTEME` serait une preuve fausse.
    user.id)
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
  await exigerAdministration()
  const y = new Date().getUTCFullYear()
  await loadFrenchHolidays(y - 1, y + 2)
  revalidatePath('/admin/saisie')
}

export async function lancerReetalonnage() {
  const user = await exigerAdministration()
  const r = await recalibrateOpenMonths(user.id)
  revalidatePath('/admin/saisie')
  return r
}
