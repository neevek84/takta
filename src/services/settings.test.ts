import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import {
  getSettings,
  updateSettings,
  validateSettingsPatch,
  DEFAULT_SLOTS,
  SettingsValidationError,
} from './settings'
import { prisma } from '@/db/client'
import { readAuditSince } from './audit'

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

describe('plage journée', () => {
  it('vaut 9 h – 18 h par défaut', async () => {
    await prisma.settings.deleteMany({})
    const s = await getSettings()
    expect({ debut: s.journeeDebutMinute, fin: s.journeeFinMinute }).toEqual({
      debut: 540,
      fin: 1080,
    })
  })

  it('enregistre une plage explicite', async () => {
    const s = await updateSettings({ journeeDebutMinute: 480, journeeFinMinute: 960 })
    expect({ debut: s.journeeDebutMinute, fin: s.journeeFinMinute }).toEqual({
      debut: 480,
      fin: 960,
    })
  })

  it('refuse une fin antérieure ou égale au début', () => {
    expect(
      validateSettingsPatch({ journeeDebutMinute: 600, journeeFinMinute: 600 }),
    ).toEqual({
      ok: false,
      errors: ['La fin de la plage journée doit être postérieure à son début.'],
    })
  })

  it('refuse une borne hors des 24 heures', () => {
    expect(validateSettingsPatch({ journeeDebutMinute: -1 }).ok).toBe(false)
    expect(validateSettingsPatch({ journeeFinMinute: 1441 }).ok).toBe(false)
  })
})


describe('consignation des réglages', () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({})
  })

  it('consigne les clés modifiées et leurs valeurs', async () => {
    await updateSettings({ minutesParJour: 432, capacityMode: 'BLOCAGE' })

    const journal = await readAuditSince({ since: 0 })
    expect(journal[0]).toMatchObject({ action: 'reglage.modifie', entityType: 'Settings', entityId: 'singleton' })
    expect(journal[0]!.payload).toMatchObject({
      cles: ['minutesParJour', 'capacityMode'],
      minutesParJour: 432,
      capacityMode: 'BLOCAGE',
    })
  })

  it('résume les listes plutôt que de les recopier', async () => {
    // Recopier 60 jours fériés à chaque enregistrement noierait le journal.
    await updateSettings({ holidays: ['2026-01-01', '2026-05-01'], workingDays: [1, 2, 3, 4, 5] })

    expect((await readAuditSince({ since: 0 }))[0]!.payload).toMatchObject({
      holidays: '2 valeur(s)',
      workingDays: '5 valeur(s)',
    })
  })

  it('ne consigne rien quand la validation refuse le patch', async () => {
    await expect(updateSettings({ minutesParJour: 0 })).rejects.toThrow()
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })

  it('ne consigne aucune lecture de réglage', async () => {
    await getSettings()
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })
})
