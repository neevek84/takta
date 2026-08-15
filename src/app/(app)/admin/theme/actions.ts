'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
// Écart assumé au brief : la tâche 5 a porté `getTheme`/`updateTheme`/
// `resetTheme`/`ThemeValidationError` dans `@/services/settings`, aux côtés
// des autres réglages d'instance, plutôt que dans un `@/services/theme`
// séparé. Le contrat (signatures, comportement) est inchangé.
import { updateTheme, resetTheme, ThemeValidationError } from '@/services/settings'
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

export async function restoreDefaultTheme(): Promise<void> {
  await requireUser()
  await resetTheme()
  revalidatePath('/', 'layout')
}
