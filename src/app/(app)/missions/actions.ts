'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import type { DisplayUnit } from '@/core/types'

export async function addClient(formData: FormData) {
  await requireUser()
  await createClient(String(formData.get('name')))
  revalidatePath('/missions')
}

export async function addMission(formData: FormData) {
  await requireUser()
  await createMission({
    clientId: String(formData.get('clientId')),
    label: String(formData.get('label')),
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
