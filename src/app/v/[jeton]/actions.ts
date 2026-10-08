'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  confirmerDepuisPage,
  demanderCode,
  renouvelerDepuisPage,
  verifierCode,
} from '@/services/signature/lien-client'
import { autoriser } from '@/services/signature/limiteur'
import { lienDeLaSession, ouvrirSession } from './session'

function jetonDe(formData: FormData): string {
  const j = String(formData.get('jeton') ?? '')
  return /^[0-9a-f]{64}$/.test(j) ? j : '0'.repeat(64)
}

/**
 * L'adresse du client **telle que le proxy de confiance l'a vue** : la
 * dernière entrée de `x-forwarded-for` (celle qu'il ajoute lui-même — les
 * précédentes viennent du client et se falsifient), sinon `x-real-ip`.
 *
 * Sans aucun des deux, `null` : la limite par IP est alors sautée plutôt que
 * de ranger tous les clients dans un même seau. Les limites par lien (5 essais
 * par code, 5 codes par heure) restent la garde.
 */
async function ip(): Promise<string | null> {
  const h = await headers()
  const chaine = h.get('x-forwarded-for')
  const derniere = chaine?.split(',').pop()?.trim()
  if (derniere !== undefined && derniere !== '') return derniere
  const reelle = h.get('x-real-ip')?.trim()
  return reelle !== undefined && reelle !== '' ? reelle : null
}

export async function demanderCodeAction(formData: FormData): Promise<void> {
  const jeton = jetonDe(formData)
  const r = await demanderCode(jeton)
  redirect(r.ok ? `/v/${jeton}?etape=code` : `/v/${jeton}?erreur=${r.raison}`)
}

export async function validerCodeAction(formData: FormData): Promise<void> {
  const jeton = jetonDe(formData)
  const adresse = await ip()
  if (adresse !== null && !autoriser(adresse)) redirect(`/v/${jeton}?etape=code&erreur=LIMITE`)

  const r = await verifierCode(jeton, String(formData.get('code') ?? ''))
  if (!r.ok) redirect(`/v/${jeton}?etape=code&erreur=${r.raison}`)

  await ouvrirSession(jeton, r.lienId)
  redirect(`/v/${jeton}`)
}

/**
 * Appelée par le cadre de signature quand il annonce « signé » ou « refusé ».
 * Ne transmet **rien** de ce que le navigateur raconte : le service relit
 * l'état chez le prestataire.
 */
export async function confirmerSignature(jeton: string): Promise<void> {
  const lienId = await lienDeLaSession(jeton)
  if (lienId === null) return
  await confirmerDepuisPage(lienId)
  revalidatePath(`/v/${jeton}`)
}

export async function renouvelerSignature(jeton: string): Promise<void> {
  const lienId = await lienDeLaSession(jeton)
  if (lienId === null) return
  await renouvelerDepuisPage(lienId)
  revalidatePath(`/v/${jeton}`)
}
