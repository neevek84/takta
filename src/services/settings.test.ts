import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import {
  getSettings,
  updateSettings,
  validateSettingsPatch,
  DEFAULT_SLOTS,
  SettingsValidationError,
  getTheme,
  updateTheme,
  resetTheme,
  validateTheme,
  ThemeValidationError,
} from './settings'
import { prisma } from '@/db/client'
import { THEME_KREATIVPM, THEME_NEUTRE, THEME_TOKEN_KEYS } from '@/core/theme/tokens'

afterAll(async () => {
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('réglages', () => {
  it('crée le singleton avec les créneaux par défaut', async () => {
    const s = await getSettings()
    expect(s.minutesParJour).toBe(480)
    expect(s.capacityMode).toBe('AVERTISSEMENT')
    expect(s.workingDays).toEqual([1, 2, 3, 4, 5])
    expect(s.slots).toEqual(DEFAULT_SLOTS)
  })

  it('inclut un créneau de nuit par défaut', () => {
    const nuit = DEFAULT_SLOTS.find((s) => s.id === 'nuit')
    expect(nuit).toBeDefined()
    expect(nuit!.startMinute).toBe(1320)
    expect(nuit!.endMinute).toBe(360)
  })

  it('met à jour la durée d une journée', async () => {
    const s = await updateSettings({ minutesParJour: 432 })
    expect(s.minutesParJour).toBe(432)
    expect((await getSettings()).minutesParJour).toBe(432)
  })

  it('met à jour les jours ouvrés', async () => {
    const s = await updateSettings({ workingDays: [1, 2, 3, 4, 5, 6] })
    expect(s.workingDays).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('remplace intégralement les créneaux', async () => {
    const s = await updateSettings({
      slots: [{ id: 'x', label: 'Bloc', startMinute: 0, endMinute: 60, centiemes: 10 }],
    })
    expect(s.slots).toHaveLength(1)
    expect(s.slots[0]!.label).toBe('Bloc')
  })

  it('accepte les trois modes de capacité', async () => {
    for (const mode of ['DESACTIVE', 'AVERTISSEMENT', 'BLOCAGE'] as const) {
      const s = await updateSettings({ capacityMode: mode })
      expect(s.capacityMode).toBe(mode)
    }
  })
})

describe('validation des réglages (C4 — perte de données silencieuse)', () => {
  it('refuse minutesParJour = 0 et ne le persiste jamais', async () => {
    const before = await updateSettings({ minutesParJour: 432 })
    expect(before.minutesParJour).toBe(432)

    await expect(updateSettings({ minutesParJour: 0 })).rejects.toThrow(SettingsValidationError)

    // La valeur aberrante n'a jamais atteint la base : la valeur précédente
    // tient toujours. C'est le scénario exact de la revue (C4) : un champ
    // « heures » vidé enverrait 0, et minutesParJour = 0 fait ensuite
    // disparaître silencieusement toute saisie via parseQuantity/saveEntry.
    const after = await getSettings()
    expect(after.minutesParJour).toBe(432)
    expect(after.minutesParJour).not.toBe(0)
  })

  it('refuse un minutesParJour négatif', async () => {
    await expect(updateSettings({ minutesParJour: -60 })).rejects.toThrow(SettingsValidationError)
  })

  it('refuse un minutesParJour aberrant au-delà d’une journée réelle', async () => {
    await expect(updateSettings({ minutesParJour: 999_999 })).rejects.toThrow(
      SettingsValidationError,
    )
  })

  it('refuse un minutesParJour non entier', async () => {
    const result = validateSettingsPatch({ minutesParJour: 90.5 })
    expect(result.ok).toBe(false)
  })

  it('refuse un capacityCentiemes nul ou négatif', async () => {
    await expect(updateSettings({ capacityCentiemes: 0 })).rejects.toThrow(SettingsValidationError)
    await expect(updateSettings({ capacityCentiemes: -100 })).rejects.toThrow(
      SettingsValidationError,
    )
  })

  it('refuse un capacityCentiemes NaN (champ vidé côté formulaire)', async () => {
    const result = validateSettingsPatch({ capacityCentiemes: Math.round(NaN * 100) })
    expect(result.ok).toBe(false)
  })

  it('refuse un capacityMode hors des trois valeurs admises', async () => {
    // @ts-expect-error valeur volontairement invalide, comme le ferait
    // `String(formData.get('capacityMode'))` sur un champ trafiqué.
    await expect(updateSettings({ capacityMode: 'TOUJOURS' })).rejects.toThrow(
      SettingsValidationError,
    )
  })

  it('refuse un jour ouvré hors de 1..7', async () => {
    await expect(updateSettings({ workingDays: [0, 1, 2] })).rejects.toThrow(
      SettingsValidationError,
    )
    await expect(updateSettings({ workingDays: [1, 8] })).rejects.toThrow(SettingsValidationError)
  })

  it('refuse un doublon dans les jours ouvrés', async () => {
    await expect(updateSettings({ workingDays: [1, 2, 2, 3] })).rejects.toThrow(
      SettingsValidationError,
    )
  })

  it('refuse un doublon d’identifiant de créneau', async () => {
    await expect(
      updateSettings({
        slots: [
          { id: 'x', label: 'Un', startMinute: 0, endMinute: 60, centiemes: 10 },
          { id: 'x', label: 'Deux', startMinute: 60, endMinute: 120, centiemes: 10 },
        ],
      }),
    ).rejects.toThrow(SettingsValidationError)
  })

  it('refuse un créneau à la valeur nulle ou négative', async () => {
    await expect(
      updateSettings({
        slots: [{ id: 'x', label: 'Un', startMinute: 0, endMinute: 60, centiemes: 0 }],
      }),
    ).rejects.toThrow(SettingsValidationError)
  })

  it('accepte un créneau qui franchit minuit (Nuit 22:00 → 06:00)', async () => {
    const s = await updateSettings({
      slots: [{ id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 }],
    })
    expect(s.slots).toEqual([
      { id: 'nuit', label: 'Nuit', startMinute: 1320, endMinute: 360, centiemes: 50 },
    ])
  })

  it('refuse une unité d’affichage par défaut invalide', async () => {
    // @ts-expect-error valeur volontairement invalide
    await expect(updateSettings({ defaultDisplayUnit: 'SEMAINE' })).rejects.toThrow(
      SettingsValidationError,
    )
  })

  it('accepte et persiste l’unité d’affichage par défaut', async () => {
    const s = await updateSettings({ defaultDisplayUnit: 'HEURE' })
    expect(s.defaultDisplayUnit).toBe('HEURE')
    expect((await getSettings()).defaultDisplayUnit).toBe('HEURE')
  })

  it('refuse une source d’engagement par défaut invalide', async () => {
    // @ts-expect-error valeur volontairement invalide
    await expect(updateSettings({ defaultEngagementSource: 'EXCEL' })).rejects.toThrow(
      SettingsValidationError,
    )
  })

  it('accepte et persiste la source d’engagement par défaut', async () => {
    const s = await updateSettings({ defaultEngagementSource: 'DOLIBARR_PROPALE' })
    expect(s.defaultEngagementSource).toBe('DOLIBARR_PROPALE')
    expect((await getSettings()).defaultEngagementSource).toBe('DOLIBARR_PROPALE')
  })

  it('renvoie des messages d’erreur en français, sans écrire en base', async () => {
    const result = validateSettingsPatch({ minutesParJour: 0, capacityCentiemes: -1 })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
      for (const message of result.errors) {
        expect(message).toMatch(/[a-zA-ZÀ-ÿ]/)
      }
    }
  })
})

describe('réglages d exercice', () => {
  it('expose des valeurs par défaut neutres', async () => {
    // Les tests précédents du fichier ont muté le singleton : on repart
    // d'une base vierge, sinon ce test dépendrait de l'ordre d'exécution.
    await prisma.settings.deleteMany({})

    const s = await getSettings()
    expect(s.objectifCaExerciceCents).toBe(0)
    expect(s.debutExerciceMois).toBe(1)
  })

  it('persiste un objectif et un mois de début', async () => {
    const s = await updateSettings({ objectifCaExerciceCents: 15_000_000, debutExerciceMois: 4 })
    expect(s.objectifCaExerciceCents).toBe(15_000_000)
    expect(s.debutExerciceMois).toBe(4)

    const relu = await getSettings()
    expect(relu.objectifCaExerciceCents).toBe(15_000_000)
    expect(relu.debutExerciceMois).toBe(4)
  })

  it('refuse un mois de début hors de 1-12 et ne le persiste jamais', async () => {
    await updateSettings({ debutExerciceMois: 4 })

    await expect(updateSettings({ debutExerciceMois: 0 })).rejects.toThrow()
    await expect(updateSettings({ debutExerciceMois: 13 })).rejects.toThrow()

    expect((await getSettings()).debutExerciceMois).toBe(4)
  })

  it('refuse un mois de début non entier', async () => {
    await expect(updateSettings({ debutExerciceMois: 4.5 })).rejects.toThrow()
  })

  it('refuse un objectif négatif', async () => {
    await expect(updateSettings({ objectifCaExerciceCents: -1 })).rejects.toThrow()
  })

  it('accepte un objectif nul, qui signifie non défini', async () => {
    const s = await updateSettings({ objectifCaExerciceCents: 0 })
    expect(s.objectifCaExerciceCents).toBe(0)
  })
})

describe('thème', () => {
  // Portée à ce seul describe : les tests précédents de ce fichier mutent le
  // singleton et ne doivent pas en être affectés. Chaque test de thème part
  // d'une base vierge, comme l'exige « rend la palette KreativPM sur une
  // base vierge ».
  beforeEach(async () => {
    await prisma.settings.deleteMany({})
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
})
