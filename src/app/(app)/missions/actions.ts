'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import type { DisplayUnit } from '@/core/types'

/**
 * Convertit une saisie en heures (formulaire) en minutes entières pour la
 * surcharge de durée d'une journée. Vide ou aberrant (≤ 0, > 24 h) revient à
 * `null`, c'est-à-dire hérité — le serveur reste la seule barrière qui
 * compte, le `min`/`max` du champ HTML n'empêchant rien.
 */
function surchargeOuNull(brut: FormDataEntryValue | null): number | null {
  const s = String(brut ?? '').trim()
  if (s === '') return null
  const heures = Number(s)
  if (!Number.isFinite(heures) || heures <= 0 || heures > 24) return null
  return Math.round(heures * 60)
}

export async function addClient(formData: FormData) {
  await requireUser()
  await createClient(String(formData.get('name')), surchargeOuNull(formData.get('heuresParJour')))
  revalidatePath('/missions')
}

export async function addMission(formData: FormData) {
  await requireUser()
  await createMission({
    clientId: String(formData.get('clientId')),
    label: String(formData.get('label')),
    minutesParJour: surchargeOuNull(formData.get('heuresParJour')),
  })
  revalidatePath('/missions')
}

export async function addLine(formData: FormData) {
  const user = await requireUser()
  await createLine({
    missionId: String(formData.get('missionId')),
    userId: user.id,
    label: String(formData.get('label')),
    soldCentiemes: Math.round(Number(formData.get('joursVendus')) * 100),
    tjmCents: Math.round(Number(formData.get('tjm')) * 100),
    displayUnit: String(formData.get('displayUnit')) as DisplayUnit,
  })
  revalidatePath('/missions')
  revalidatePath('/saisie')
}
