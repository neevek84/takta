'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { updateTheme, resetTheme, ThemeValidationError } from '@/services/theme'
import { THEME_TOKEN_KEYS } from '@/core/theme/tokens'

export type SaveThemeState = { ok: true } | { ok: false; errors: string[] } | null

/**
 * Transcrit le formulaire et relaie le verdict. Aucune règle de couleur ici :
 * elles vivent toutes dans `validateTheme`, côté service.
 */
export async function saveTheme(
  _prevState: SaveThemeState,
  formData: FormData,
): Promise<SaveThemeState> {
  await requireUser()

  const brut: Record<string, unknown> = {}
  for (const key of THEME_TOKEN_KEYS) {
    brut[key] = formData.get(key)
  }

  try {
    await updateTheme(brut)
  } catch (err) {
    if (err instanceof ThemeValidationError) return { ok: false, errors: err.errors }
    throw err
  }

  // Le thème est lu par le layout racine : c'est la racine qu'il faut revalider.
  revalidatePath('/', 'layout')
  return { ok: true }
}

/**
 * Rend un verdict au lieu de jeter, et pour la même raison que `saveTheme` :
 * l'écran doit pouvoir dire ce qui s'est passé. Une session expirée ou une
 * base indisponible produiraient sinon un rejet que personne n'écoute,
 * pendant que l'écran, lui, se serait déjà repeint au défaut — l'utilisateur
 * quitterait la page convaincu d'avoir réinitialisé le thème.
 *
 * Aucune validation n'est contournée : `resetTheme` repasse par `updateTheme`.
 */
export async function restoreDefaultTheme(): Promise<Exclude<SaveThemeState, null>> {
  try {
    await requireUser()
    await resetTheme()
  } catch (err) {
    if (err instanceof ThemeValidationError) return { ok: false, errors: err.errors }
    // Le détail reste au journal du serveur : il peut nommer la base.
    console.error('Retour au thème par défaut impossible :', err)
    return {
      ok: false,
      errors: ['Vérifiez que votre session est toujours ouverte, puis réessayez.'],
    }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
