'use server'

import { annoncer } from '@/services/annonce'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireUser } from '@/auth'
import { runSignatureReminders } from '@/services/signature/reminders'

export async function lancerRelances(): Promise<void> {
  const user = await requireUser()
  // Scopé sur l'utilisateur : ce bouton n'est pas l'ordonnanceur, c'est le
  // moyen de s'en passer.
  const r = await runSignatureReminders({ userId: user.id })
  await annoncer(
    r.relancees === 0 && r.abandonnees === 0
      ? 'Aucune relance n’était échue.'
      : `${r.relancees} relance(s) envoyée(s), ${r.abandonnees} demande(s) abandonnée(s).`,
    r.echecs > 0 ? 'warning' : 'success',
  )
  revalidatePath('/cra')
  // Le suivi couvre désormais toutes les périodes : il n'y a plus de mois à
  // reporter dans l'adresse de retour.
  redirect('/cra')
}
