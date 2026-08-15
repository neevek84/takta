import { describe, it, expect, afterAll } from 'vitest'
import { getSettings, updateSettings, DEFAULT_SLOTS } from './settings'
import { prisma } from '@/db/client'

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
