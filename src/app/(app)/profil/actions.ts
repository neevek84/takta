'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { disconnectGoogle } from '@/services/google/connect'
import {
  definirIdentifiantDolibarr,
  oublierIdentifiantDolibarr,
} from '@/services/dolibarr/utilisateur'

export type ProfilState = { ok: boolean; message: string } | null

/**
 * `requireUser()` et non `exigerAdministration()` : ce sont les réglages de la
 * personne, et un consultant doit pouvoir les poser. Le cloisonnement est
 * ailleurs — chaque fonction appelée ne touche que le compte de la session, et
 * l'identifiant visé n'est jamais lu du formulaire.
 */
export async function enregistrerIdentifiantDolibarr(
  _precedent: ProfilState,
  formData: FormData,
): Promise<ProfilState> {
  const user = await requireUser()
  const brut = String(formData.get('identifiant') ?? '').trim()

  if (brut === '') {
    await oublierIdentifiantDolibarr(user.id)
    revalidatePath('/profil')
    return {
      ok: true,
      message:
        'Correspondance rompue. Vos CRA ne partiront plus vers Dolibarr tant qu’aucun identifiant ' +
        'n’est renseigné — rien n’a été supprimé dans Dolibarr.',
    }
  }

  if (!/^\d+$/.test(brut)) {
    return {
      ok: false,
      message:
        'L’identifiant de l’utilisateur Dolibarr est un nombre — celui de votre fiche utilisateur, ' +
        'pas votre identifiant de connexion. Dans Dolibarr : Utilisateurs & groupes, ouvrez votre ' +
        'fiche, le nombre est à la fin de son adresse (…?id=3).',
    }
  }

  const r = await definirIdentifiantDolibarr(user.id, Number(brut))
  revalidatePath('/profil')
  return r.ok
    ? { ok: true, message: `Vos temps partiront sous l’utilisateur Dolibarr n° ${brut}.` }
    : { ok: false, message: r.motif }
}

/**
 * Déconnecte l'agenda de la session — au sens strict : les jetons stockés ici
 * sont effacés, rien de plus. L'autorisation accordée chez Google reste active
 * jusqu'à ce que la personne l'y retire elle-même ; l'écran le dit.
 */
export async function deconnecterGoogle(): Promise<void> {
  const user = await requireUser()
  await disconnectGoogle(user.id)
  revalidatePath('/profil')
}
