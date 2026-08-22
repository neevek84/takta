import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  DEFAULT_THEME_CONFIG,
  THEME_KREATIVPM,
  THEME_SOMBRE,
  THEME_TOKEN_KEYS,
} from '@/core/theme/tokens'

const { requireUser, revalidatePath, updateThemeConfig, resetTheme } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  updateThemeConfig: vi.fn(),
  resetTheme: vi.fn(),
}))

vi.mock('@/auth', () => ({
  requireUser,
  // Les gardes de rôle s'appuient sur la même session, et **appliquent la vraie
  // règle** : `peutAdministrer` est importée, pas recopiée. Un double qui
  // laisserait passer un consultant ferait passer au vert une action sans
  // garde — c'est arrivé, et c'est ce test-ci qui l'a dit.
  exigerAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer, MOTIF_REFUS_ADMIN } = await import('@/core/auth/roles')
    if (!peutAdministrer(u.role)) throw new Error(MOTIF_REFUS_ADMIN)
    return u
  },
  accesAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer } = await import('@/core/auth/roles')
    return { autorise: peutAdministrer(u.role), user: u }
  },
}))
vi.mock('next/cache', () => ({ revalidatePath }))
// `ThemeValidationError` reste la vraie classe : c'est elle que l'action
// reconnaît par `instanceof`, la doubler ne prouverait rien.
vi.mock('@/services/theme', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/services/theme')>()
  return { ...reel, updateThemeConfig, resetTheme }
})

import { ThemeValidationError } from '@/services/theme'
import { saveTheme, restoreDefaultTheme } from './actions'

function formulaireComplet(mode = 'systeme'): FormData {
  const fd = new FormData()
  fd.set('mode', mode)
  for (const key of THEME_TOKEN_KEYS) {
    fd.set(`clair.${key}`, THEME_KREATIVPM[key])
    fd.set(`sombre.${key}`, THEME_SOMBRE[key])
  }
  return fd
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  updateThemeConfig.mockReset().mockResolvedValue(DEFAULT_THEME_CONFIG)
  resetTheme.mockReset().mockResolvedValue(DEFAULT_THEME_CONFIG)
  // Les chemins d'échec journalisent : le test n'a pas à en salir la sortie.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveTheme', () => {
  it('transcrit les deux palettes et le mode vers le service', async () => {
    // Contrat avec `ThemeForm` : les champs portent `name={\`${versant}.${key}\`}`
    // et un `mode`. S'il se rompt d'un côté ou de l'autre, le service reçoit
    // 88 `null` et refuse tout enregistrement — l'écran devient inutilisable.
    await saveTheme(null, formulaireComplet('sombre'))

    expect(updateThemeConfig).toHaveBeenCalledTimes(1)
    const transmis = updateThemeConfig.mock.calls[0]![0] as {
      mode: unknown
      clair: Record<string, unknown>
      sombre: Record<string, unknown>
    }
    expect(transmis.mode).toBe('sombre')
    expect(Object.keys(transmis.clair).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
    expect(Object.keys(transmis.sombre).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
    for (const key of THEME_TOKEN_KEYS) {
      expect(transmis.clair[key], `clair.${key}`).toBe(THEME_KREATIVPM[key])
      expect(transmis.sombre[key], `sombre.${key}`).toBe(THEME_SOMBRE[key])
    }
  })

  it('ne confond pas les deux versants', async () => {
    // Le mutant le plus discret : relever les deux versants depuis les mêmes
    // champs. La configuration resterait valide, et le thème sombre
    // disparaîtrait sans un mot.
    await saveTheme(null, formulaireComplet())
    const transmis = updateThemeConfig.mock.calls[0]![0] as {
      clair: Record<string, unknown>
      sombre: Record<string, unknown>
    }
    expect(transmis.clair.page).not.toBe(transmis.sombre.page)
  })

  it('revalide la racine après un enregistrement accepté', async () => {
    // C'est ce seul appel qui rend vraie la promesse « le thème s'applique
    // sans reconstruction » : le thème est lu par le layout racine.
    const etat = await saveTheme(null, formulaireComplet())

    expect(etat).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })

  it('relaie le refus du service, sans revalider', async () => {
    updateThemeConfig.mockRejectedValue(
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
    updateThemeConfig.mockRejectedValue(new Error('base injoignable'))

    await expect(saveTheme(null, formulaireComplet())).rejects.toThrow('base injoignable')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('exige une session avant d’écrire', async () => {
    requireUser.mockRejectedValue(new Error('Non authentifié'))

    await expect(saveTheme(null, formulaireComplet())).rejects.toThrow('Non authentifié')
    expect(updateThemeConfig).not.toHaveBeenCalled()
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

describe('les actions exigent le rôle, pas seulement la session', () => {
  // Une action serveur est un point d'entrée HTTP à part entière : elle est
  // atteignable sans jamais avoir affiché l'écran qui la déclare. Garder la
  // page ne garde donc rien.
  it('refuse un consultant, sans rien écrire', async () => {
    requireUser.mockResolvedValue({ id: 'u2', role: 'CONSULTANT' })

    await expect(saveTheme(null, new FormData())).rejects.toThrow(/administrateurs/)
    expect(updateThemeConfig).not.toHaveBeenCalled()
  })
})

