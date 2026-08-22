'use server'

import { revalidatePath } from 'next/cache'
import { exigerAdministration } from '@/auth'
import { definirActivation, definirRole } from '@/services/auth/comptes'
import type { Role } from '@/core/types'

export type ComptesState = { ok: boolean; message: string } | null

export async function changerRole(userId: string, role: Role): Promise<ComptesState> {
  const moi = await exigerAdministration()
  const r = await definirRole({ userId, role, parId: moi.id })
  revalidatePath('/admin/comptes')
  return r.ok ? { ok: true, message: `Rôle changé en ${role}.` } : { ok: false, message: r.motif }
}

export async function changerActivation(userId: string, actif: boolean): Promise<ComptesState> {
  const moi = await exigerAdministration()
  const r = await definirActivation({ userId, actif, parId: moi.id })
  revalidatePath('/admin/comptes')
  return r.ok
    ? {
        ok: true,
        message: actif
          ? 'Accès rouvert.'
          : 'Accès coupé. Rien n’a été supprimé : ses saisies, ses CRA et l’attribution de ses temps restent.',
      }
    : { ok: false, message: r.motif }
}
