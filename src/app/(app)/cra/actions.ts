'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { getOrCreateCra } from '@/services/cra'
import { runSignatureReminders } from '@/services/signature/reminders'

export async function openCra(formData: FormData) {
  const user = await requireUser()
  await getOrCreateCra(user.id, String(formData.get('missionId')), String(formData.get('month')))
  revalidatePath('/cra')
}

/**
 * `lancerRelances` ne rend rien : le résultat repasse par l'URL. Elle reste
 * ciblée sur la liste — c'est un bouton de lot, pas d'un CRA en particulier.
 */
function retour(month: string): never {
  redirect(`/cra?month=${encodeURIComponent(month)}`)
}

export async function lancerRelances(formData: FormData): Promise<void> {
  const user = await requireUser()
  // Scopé sur l'utilisateur : ce bouton n'est pas l'ordonnanceur, c'est le
  // moyen de s'en passer.
  await runSignatureReminders({ userId: user.id })
  revalidatePath('/cra')
  retour(String(formData.get('month')))
}
