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

async function ip(): Promise<string> {
  const h = await headers()
  return (h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? 'inconnue').split(',')[0]!.trim()
}

export async function demanderCodeAction(formData: FormData): Promise<void> {
  const jeton = jetonDe(formData)
  const r = await demanderCode(jeton)
  redirect(r.ok ? `/v/${jeton}?etape=code` : `/v/${jeton}?erreur=${r.raison}`)
}

export async function validerCodeAction(formData: FormData): Promise<void> {
  const jeton = jetonDe(formData)
  if (!autoriser(await ip())) redirect(`/v/${jeton}?etape=code&erreur=LIMITE`)

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
