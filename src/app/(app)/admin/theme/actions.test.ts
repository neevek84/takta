import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { THEME_KREATIVPM, THEME_TOKEN_KEYS } from '@/core/theme/tokens'

const { requireUser, revalidatePath, updateTheme, resetTheme } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  updateTheme: vi.fn(),
  resetTheme: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/cache', () => ({ revalidatePath }))
// `ThemeValidationError` reste la vraie classe : c'est elle que l'action
// reconnaît par `instanceof`, la doubler ne prouverait rien.
vi.mock('@/services/theme', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/services/theme')>()
  return { ...reel, updateTheme, resetTheme }
})

import { ThemeValidationError } from '@/services/theme'
import { saveTheme, restoreDefaultTheme } from './actions'

function formulaireComplet(): FormData {
  const fd = new FormData()
  for (const key of THEME_TOKEN_KEYS) fd.set(key, THEME_KREATIVPM[key])
  return fd
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  updateTheme.mockReset().mockResolvedValue(THEME_KREATIVPM)
  resetTheme.mockReset().mockResolvedValue(THEME_KREATIVPM)
  // Les chemins d'échec journalisent : le test n'a pas à en salir la sortie.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveTheme', () => {
  it('transcrit exactement les 26 jetons du formulaire vers le service', async () => {
    // Contrat avec `ThemeForm` : les champs portent `name={key}`. S'il se
    // rompt d'un côté ou de l'autre, le service reçoit 26 `null` et refuse
    // tout enregistrement — l'écran devient inutilisable.
    await saveTheme(null, formulaireComplet())

    expect(updateTheme).toHaveBeenCalledTimes(1)
    const transmis = updateTheme.mock.calls[0]![0] as Record<string, unknown>
    expect(Object.keys(transmis).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
    for (const key of THEME_TOKEN_KEYS) {
      expect(transmis[key], key).toBe(THEME_KREATIVPM[key])
    }
  })

  it('revalide la racine après un enregistrement accepté', async () => {
    // C'est ce seul appel qui rend vraie la promesse « le thème s'applique
    // sans reconstruction » : le thème est lu par le layout racine.
    const etat = await saveTheme(null, formulaireComplet())

    expect(etat).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('relaie le refus du service, sans revalider', async () => {
    updateTheme.mockRejectedValue(
      new ThemeValidationError(['Le couple « encre » sur « fond de page » n’atteint que 2,38:1.']),
    )

    const etat = await saveTheme(null, formulaireComplet())

    expect(etat).toEqual({
      ok: false,
      errors: ['Le couple « encre » sur « fond de page » n’atteint que 2,38:1.'],
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('relance toute autre erreur au lieu de la présenter comme un refus', async () => {
    // Une base injoignable n'est pas une palette illisible : la déguiser en
    // refus de validation ferait chercher une faute de couleur inexistante.
    updateTheme.mockRejectedValue(new Error('base injoignable'))

    await expect(saveTheme(null, formulaireComplet())).rejects.toThrow('base injoignable')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('exige une session avant d’écrire', async () => {
    requireUser.mockRejectedValue(new Error('Non authentifié'))

    await expect(saveTheme(null, formulaireComplet())).rejects.toThrow('Non authentifié')
    expect(updateTheme).not.toHaveBeenCalled()
  })
})

describe('restoreDefaultTheme', () => {
  it('restaure, revalide la racine et rend un succès', async () => {
    const etat = await restoreDefaultTheme()

    expect(resetTheme).toHaveBeenCalledTimes(1)
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
    expect(etat).toEqual({ ok: true })
  })

  it('rend un échec lisible quand la session a expiré, sans rejet non géré', async () => {
    // L'écran s'appuie sur ce retour pour ne pas repeindre les 26 champs au
    // défaut alors que la base garde l'ancienne palette.
    requireUser.mockRejectedValue(new Error('Non authentifié'))

    const etat = await restoreDefaultTheme()

    expect(etat.ok).toBe(false)
    if (!etat.ok) {
      expect(etat.errors.length).toBeGreaterThan(0)
      expect(etat.errors.join(' ')).toMatch(/[a-zA-ZÀ-ÿ]/)
    }
    expect(resetTheme).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rend un échec quand la base refuse l’écriture', async () => {
    resetTheme.mockRejectedValue(new Error('base injoignable'))

    const etat = await restoreDefaultTheme()

    expect(etat.ok).toBe(false)
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
