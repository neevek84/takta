import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import {
  getThemeConfig,
  updateThemeConfig,
  resetTheme,
  validateThemeConfig,
  ThemeValidationError,
} from './theme'
import { getSettings, updateSettings, DEFAULT_SLOTS } from './settings'
import { prisma } from '@/db/client'
import {
  DEFAULT_THEME_CONFIG,
  THEME_CLAIR,
  THEME_KREATIVPM,
  THEME_SOMBRE,
  THEME_TOKEN_KEYS,
  type ThemeConfig,
} from '@/core/theme/tokens'

/** Une configuration valide qui n'est pas le défaut, pour prouver l'écriture. */
const MARQUE: ThemeConfig = { mode: 'clair', clair: THEME_KREATIVPM, sombre: THEME_SOMBRE }

// Chaque test part d'une base vierge : « rend le thème clair sur une base
// vierge » l'exige, et les tests d'écriture mutent le singleton.
beforeEach(async () => {
  await prisma.settings.deleteMany({})
})

afterAll(async () => {
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('création de la ligne singleton', () => {
  it('crée les créneaux par défaut même quand c’est le thème qui crée la ligne', async () => {
    // Le thème est lu par le layout racine : il crée donc toujours la ligne
    // avant `getSettings`. S'il la crée autrement, la base garde à vie un
    // `slotsJson` vide que `getSettings` ne fait plus que masquer à la
    // lecture (repli sur DEFAULT_SLOTS dans `toAppSettings`).
    await getThemeConfig()
    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 'singleton' } })
    expect(JSON.parse(row.slotsJson)).toEqual(DEFAULT_SLOTS)
  })

  it('crée les créneaux par défaut même quand c’est une écriture de thème qui crée la ligne', async () => {
    await updateThemeConfig(MARQUE)
    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 'singleton' } })
    expect(JSON.parse(row.slotsJson)).toEqual(DEFAULT_SLOTS)
  })
})

describe('lecture du thème', () => {
  it('rend le clair, le sombre et la préférence du système sur une base vierge', async () => {
    expect(await getThemeConfig()).toEqual(DEFAULT_THEME_CONFIG)
  })

  it('rend la configuration enregistrée à la relecture suivante', async () => {
    await updateThemeConfig(MARQUE)
    // Relecture depuis la base : c'est ce qui survit à un redémarrage.
    expect(await getThemeConfig()).toEqual(MARQUE)
  })

  it('fait survivre le choix explicite du mode à un redémarrage', async () => {
    await updateThemeConfig({ ...DEFAULT_THEME_CONFIG, mode: 'sombre' })
    // Rien en mémoire : la relecture repart de la colonne.
    expect((await getThemeConfig()).mode).toBe('sombre')
  })

  it('ne casse pas la page quand la colonne est illisible', async () => {
    await getThemeConfig() // crée le singleton
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { themeJson: 'ceci n est pas du JSON' },
    })
    // Refuser de rendre l'application entière pour une couleur corrompue
    // serait pire que de retomber sur le défaut. La ligne n'est pas réécrite.
    expect(await getThemeConfig()).toEqual(DEFAULT_THEME_CONFIG)
  })

  it('retombe sur le mode par défaut quand le mode enregistré est inconnu', async () => {
    await getThemeConfig()
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: {
        themeJson: JSON.stringify({ mode: 'crépuscule', clair: THEME_CLAIR, sombre: THEME_SOMBRE }),
      },
    })
    expect((await getThemeConfig()).mode).toBe('systeme')
  })

  it('complète une palette partielle par le défaut de son propre versant', async () => {
    await getThemeConfig()
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: {
        themeJson: JSON.stringify({
          mode: 'systeme',
          clair: { page: '#f0f0f0' },
          sombre: { page: '#050505' },
        }),
      },
    })
    const config = await getThemeConfig()
    expect(config.clair.page).toBe('#f0f0f0')
    expect(config.sombre.page).toBe('#050505')
    // Le trou du sombre se comble avec du sombre : le combler avec l'encre
    // claire produirait une palette panachée, illisible sans être invalide.
    expect(config.clair.ink).toBe(THEME_CLAIR.ink)
    expect(config.sombre.ink).toBe(THEME_SOMBRE.ink)
    expect(config.sombre.ink).not.toBe(THEME_CLAIR.ink)
  })
})

describe('reprise du format du lot 1e', () => {
  it('relit une palette à plat comme le versant clair, sans la perdre', async () => {
    await getThemeConfig()
    // Ce que le lot 1e écrivait : les 44 jetons à la racine, sans versant.
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { themeJson: JSON.stringify(THEME_KREATIVPM) },
    })

    const config = await getThemeConfig()
    expect(config.clair).toEqual(THEME_KREATIVPM)
    expect(config.sombre).toEqual(THEME_SOMBRE)
    // Le porteur qui avait enregistré sa marque la retrouve de jour, et reçoit
    // un sombre construit de nuit : c'est ce qu'il a demandé.
    expect(config.mode).toBe('systeme')
  })

  it('ne réécrit pas la colonne au passage', async () => {
    await getThemeConfig()
    const ancien = JSON.stringify(THEME_KREATIVPM)
    await prisma.settings.update({ where: { id: 'singleton' }, data: { themeJson: ancien } })

    await getThemeConfig()

    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 'singleton' } })
    expect(row.themeJson).toBe(ancien)
  })

  it('rend le défaut sur une colonne vide, sans y voir une palette à plat', async () => {
    await getThemeConfig()
    await prisma.settings.update({ where: { id: 'singleton' }, data: { themeJson: '{}' } })
    expect(await getThemeConfig()).toEqual(DEFAULT_THEME_CONFIG)
  })
})

describe('écriture du thème', () => {
  it('écrit la configuration en bloc, jamais champ par champ', async () => {
    await updateThemeConfig(MARQUE)
    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 'singleton' } })
    const stocke = JSON.parse(row.themeJson) as Record<string, unknown>
    expect(Object.keys(stocke).sort()).toEqual(['clair', 'mode', 'sombre'])
    expect(Object.keys(stocke.clair as object).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
    expect(Object.keys(stocke.sombre as object).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
  })

  it('rend la configuration enregistrée', async () => {
    expect(await updateThemeConfig(MARQUE)).toEqual(MARQUE)
  })

  it('ne touche pas aux autres réglages', async () => {
    await updateSettings({ minutesParJour: 432 })
    await updateThemeConfig(MARQUE)
    expect((await getSettings()).minutesParJour).toBe(432)
  })
})

describe("l'éditeur refuse ce qui serait illisible", () => {
  it("refuse l'or de la marque en couleur de texte, avec le couple et le rapport", async () => {
    const fautive = { ...MARQUE, clair: { ...THEME_KREATIVPM, ink: '#d4943f' } }

    await expect(updateThemeConfig(fautive)).rejects.toThrow(ThemeValidationError)

    let message = ''
    try {
      await updateThemeConfig(fautive)
    } catch (err) {
      expect(err).toBeInstanceOf(ThemeValidationError)
      message = (err as ThemeValidationError).errors.join(' ')
    }
    expect(message).toContain('encre')
    expect(message).toContain('fond de page')
    expect(message).toContain('2,38')
    expect(message).toContain('4,50')
  })

  it('dit dans laquelle des deux palettes corriger', async () => {
    const fautive = { ...DEFAULT_THEME_CONFIG, sombre: { ...THEME_SOMBRE, ink: THEME_SOMBRE.page } }
    let errors: string[] = []
    try {
      await updateThemeConfig(fautive)
    } catch (err) {
      errors = (err as ThemeValidationError).errors
    }
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.every((e) => e.startsWith('Thème sombre —'))).toBe(true)
  })

  it('applique le garde-fou aux deux palettes, pas seulement à la claire', async () => {
    // Le point qui distingue « trois thèmes » de « un thème plus deux
    // apparences » : une palette sombre illisible doit être refusée, même si
    // le versant clair est irréprochable.
    const fautive = {
      ...DEFAULT_THEME_CONFIG,
      sombre: { ...THEME_SOMBRE, muted: THEME_SOMBRE.surface },
    }
    await expect(updateThemeConfig(fautive)).rejects.toThrow(ThemeValidationError)
  })

  it('refuse une palette claire glissée dans l’emplacement sombre', async () => {
    let errors: string[] = []
    try {
      await updateThemeConfig({ ...DEFAULT_THEME_CONFIG, sombre: THEME_CLAIR })
    } catch (err) {
      errors = (err as ThemeValidationError).errors
    }
    expect(errors.join(' ')).toContain('en réalité une palette claire')
  })

  it("n'enregistre rien quand la configuration est refusée", async () => {
    await updateThemeConfig(MARQUE)
    await updateThemeConfig({
      ...MARQUE,
      clair: { ...THEME_KREATIVPM, ink: '#d4943f' },
    }).catch(() => undefined)
    // La palette refusée ne doit pas être passée « en avertissement ».
    expect(await getThemeConfig()).toEqual(MARQUE)
  })

  it('refuse une couleur mal écrite', async () => {
    await expect(
      updateThemeConfig({ ...MARQUE, clair: { ...THEME_KREATIVPM, page: 'crème' } }),
    ).rejects.toThrow(ThemeValidationError)
    await expect(
      updateThemeConfig({ ...MARQUE, clair: { ...THEME_KREATIVPM, page: '#fff' } }),
    ).rejects.toThrow(ThemeValidationError)
  })

  it('refuse une palette incomplète', async () => {
    const { ink, ...sansEncre } = THEME_KREATIVPM
    void ink
    await expect(updateThemeConfig({ ...MARQUE, clair: sansEncre })).rejects.toThrow(
      ThemeValidationError,
    )
  })

  it('refuse un mode inconnu au lieu de le corriger en silence', async () => {
    // À la lecture, un mode inconnu retombe sur le défaut : un habillage ne
    // fait pas tomber la page. À l'écriture, il est refusé : accepter la
    // saisie en la changeant ferait mentir l'écran.
    await expect(updateThemeConfig({ ...DEFAULT_THEME_CONFIG, mode: 'auto' })).rejects.toThrow(
      ThemeValidationError,
    )
  })

  it('accepte les trois préréglages livrés', () => {
    expect(validateThemeConfig(DEFAULT_THEME_CONFIG).ok).toBe(true)
    expect(validateThemeConfig(MARQUE).ok).toBe(true)
    expect(validateThemeConfig({ ...DEFAULT_THEME_CONFIG, mode: 'sombre' }).ok).toBe(true)
  })

  it('valide sans écrire quand on le lui demande', () => {
    const verdict = validateThemeConfig({
      ...MARQUE,
      clair: { ...THEME_KREATIVPM, ink: '#d4943f' },
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.errors.length).toBeGreaterThan(0)
  })
})

describe('retour au défaut', () => {
  it('restaure exactement la configuration livrée', async () => {
    await updateThemeConfig(MARQUE)
    expect(await resetTheme()).toEqual(DEFAULT_THEME_CONFIG)
    expect(await getThemeConfig()).toEqual(DEFAULT_THEME_CONFIG)
  })
})
