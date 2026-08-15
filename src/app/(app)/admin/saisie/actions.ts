'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { updateSettings, loadFrenchHolidays } from '@/services/settings'
import type { CapacityMode } from '@/core/types'

export async function saveSettings(formData: FormData) {
  await requireUser()

  const heures = Number(formData.get('heures'))
  const minutesSup = Number(formData.get('minutes'))

  await updateSettings({
    minutesParJour: heures * 60 + minutesSup,
    capacityMode: String(formData.get('capacityMode')) as CapacityMode,
    capacityCentiemes: Math.round(Number(formData.get('capaciteJours')) * 100),
    workingDays: formData.getAll('workingDays').map((d) => Number(d)),
  })

  revalidatePath('/admin/saisie')
}

export async function reloadHolidays() {
  await requireUser()
  const y = new Date().getUTCFullYear()
  await loadFrenchHolidays(y - 1, y + 2)
  revalidatePath('/admin/saisie')
}
