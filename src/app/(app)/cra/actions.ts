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

export async function lancerRelances(): Promise<void> {
  const user = await requireUser()
  // Scopé sur l'utilisateur : ce bouton n'est pas l'ordonnanceur, c'est le
  // moyen de s'en passer.
  await runSignatureReminders({ userId: user.id })
  revalidatePath('/cra')
  // Le suivi couvre désormais toutes les périodes : il n'y a plus de mois à
  // reporter dans l'adresse de retour.
  redirect('/cra')
}
