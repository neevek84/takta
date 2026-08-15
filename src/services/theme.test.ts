import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { getTheme, updateTheme, resetTheme, validateTheme, ThemeValidationError } from './theme'
import { getSettings, updateSettings, DEFAULT_SLOTS } from './settings'
import { prisma } from '@/db/client'
import { THEME_KREATIVPM, THEME_NEUTRE, THEME_TOKEN_KEYS } from '@/core/theme/tokens'

// Chaque test part d'une base vierge : « rend la palette KreativPM sur une
// base vierge » l'exige, et les tests d'écriture mutent le singleton.
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
    await getTheme()
    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 'singleton' } })
    expect(JSON.parse(row.slotsJson)).toEqual(DEFAULT_SLOTS)
  })

  it('crée les créneaux par défaut même quand c’est une écriture de thème qui crée la ligne', async () => {
    await updateTheme(THEME_NEUTRE)
    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 'singleton' } })
    expect(JSON.parse(row.slotsJson)).toEqual(DEFAULT_SLOTS)
  })
})

describe('lecture du thème', () => {
  it('rend la palette KreativPM sur une base vierge', async () => {
    expect(await getTheme()).toEqual(THEME_KREATIVPM)
  })

  it('rend le thème enregistré à la relecture suivante', async () => {
    await updateTheme(THEME_NEUTRE)
    // Relecture depuis la base : c'est ce qui survit à un redémarrage.
    expect(await getTheme()).toEqual(THEME_NEUTRE)
  })

  it('ne casse pas la page quand la colonne est illisible', async () => {
    await getTheme() // crée le singleton
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { themeJson: 'ceci n est pas du JSON' },
    })
    // Refuser de rendre l'application entière pour une couleur corrompue
    // serait pire que de retomber sur le défaut. La ligne n'est pas réécrite.
    expect(await getTheme()).toEqual(THEME_KREATIVPM)
  })

  it('complète une palette partielle par le défaut', async () => {
    await getTheme()
    await prisma.settings.update({
      where: { id: 'singleton' },
      data: { themeJson: JSON.stringify({ page: '#f0f0f0' }) },
    })
    const theme = await getTheme()
    expect(theme.page).toBe('#f0f0f0')
    expect(theme.ink).toBe(THEME_KREATIVPM.ink)
  })
})

describe('écriture du thème', () => {
  it('écrit la palette en bloc, jamais champ par champ', async () => {
    await updateTheme(THEME_NEUTRE)
    const row = await prisma.settings.findUniqueOrThrow({ where: { id: 'singleton' } })
    const stocke = JSON.parse(row.themeJson) as Record<string, string>
    expect(Object.keys(stocke).sort()).toEqual([...THEME_TOKEN_KEYS].sort())
  })

  it('rend la palette enregistrée', async () => {
    expect(await updateTheme(THEME_NEUTRE)).toEqual(THEME_NEUTRE)
  })

  it('ne touche pas aux autres réglages', async () => {
    await updateSettings({ minutesParJour: 432 })
    await updateTheme(THEME_NEUTRE)
    expect((await getSettings()).minutesParJour).toBe(432)
  })
})

describe("l'éditeur refuse ce qui serait illisible", () => {
  it("refuse l'or de la marque en couleur de texte, avec le couple et le rapport", async () => {
    const fautive = { ...THEME_KREATIVPM, ink: '#d4943f' }

    await expect(updateTheme(fautive)).rejects.toThrow(ThemeValidationError)

    let message = ''
    try {
      await updateTheme(fautive)
    } catch (err) {
      expect(err).toBeInstanceOf(ThemeValidationError)
      message = (err as ThemeValidationError).errors.join(' ')
    }
    expect(message).toContain('encre')
    expect(message).toContain('fond de page')
    expect(message).toContain('2,38')
    expect(message).toContain('4,50')
  })

  it("n'enregistre rien quand la palette est refusée", async () => {
    await updateTheme(THEME_NEUTRE)
    await updateTheme({ ...THEME_KREATIVPM, ink: '#d4943f' }).catch(() => undefined)
    // La palette refusée ne doit pas être passée « en avertissement ».
    expect(await getTheme()).toEqual(THEME_NEUTRE)
  })

  it('refuse une couleur mal écrite', async () => {
    await expect(updateTheme({ ...THEME_KREATIVPM, page: 'crème' })).rejects.toThrow(
      ThemeValidationError,
    )
    await expect(updateTheme({ ...THEME_KREATIVPM, page: '#fff' })).rejects.toThrow(
      ThemeValidationError,
    )
  })

  it('refuse une palette incomplète', async () => {
    const { ink, ...sansEncre } = THEME_KREATIVPM
    void ink
    await expect(updateTheme(sansEncre)).rejects.toThrow(ThemeValidationError)
  })

  it('accepte les deux préréglages livrés', async () => {
    expect(validateTheme(THEME_KREATIVPM).ok).toBe(true)
    expect(validateTheme(THEME_NEUTRE).ok).toBe(true)
  })

  it('valide sans écrire quand on le lui demande', () => {
    const verdict = validateTheme({ ...THEME_KREATIVPM, ink: '#d4943f' })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.errors.length).toBeGreaterThan(0)
  })
})

describe('retour au défaut', () => {
  it('restaure exactement la palette KreativPM', async () => {
    await updateTheme(THEME_NEUTRE)
    expect(await resetTheme()).toEqual(THEME_KREATIVPM)
    expect(await getTheme()).toEqual(THEME_KREATIVPM)
  })
})
