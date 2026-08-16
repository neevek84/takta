import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { requireUser, revalidatePath, updateSettings, recalibrateOpenMonths } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  updateSettings: vi.fn(),
  recalibrateOpenMonths: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/rates', () => ({ recalibrateOpenMonths }))
// `SettingsValidationError` reste la vraie classe : c'est elle que l'action
// reconnaît par `instanceof`, la doubler ne prouverait rien.
vi.mock('@/services/settings', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/services/settings')>()
  return { ...reel, updateSettings }
})

import { saveSettings } from './actions'

/** Un formulaire complet : l'action transcrit tous ses champs d'un bloc. */
function formulaire(patch: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const champs: Record<string, string> = {
    heures: '8',
    minutes: '0',
    capacityMode: 'AVERTISSEMENT',
    capaciteJours: '1',
    slotsJson: '[]',
    defaultDisplayUnit: 'JOUR',
    defaultEngagementSource: 'MANUEL',
    objectifCaEuros: '0',
    debutExerciceMois: '1',
    journeeDebut: '09:00',
    journeeFin: '18:00',
    ...patch,
  }
  for (const [k, v] of Object.entries(champs)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  updateSettings.mockReset().mockResolvedValue({})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveSettings — plage journée', () => {
  it('transcrit les heures saisies en minutes depuis minuit', async () => {
    await saveSettings(null, formulaire({ journeeDebut: '08:30', journeeFin: '16:45' }))

    expect(updateSettings).toHaveBeenCalledTimes(1)
    const patch = updateSettings.mock.calls[0]![0] as Record<string, unknown>
    expect({ debut: patch.journeeDebutMinute, fin: patch.journeeFinMinute }).toEqual({
      debut: 510,
      fin: 1005,
    })
  })

  it('laisse passer une heure illisible en NaN, que le service refusera', async () => {
    // Ne rien envoyer plutôt que d'envoyer NaN reviendrait à enregistrer les
    // autres réglages en gardant silencieusement l'ancienne plage : c'est la
    // validation du service, en français, qui doit avoir le dernier mot.
    await saveSettings(null, formulaire({ journeeDebut: 'n importe quoi' }))

    const patch = updateSettings.mock.calls[0]![0] as Record<string, unknown>
    expect(Number.isNaN(patch.journeeDebutMinute)).toBe(true)
  })
})

describe('attribution au journal de preuve', () => {
  it('transmet l utilisateur de la session au service des réglages', async () => {
    // Sans ce second argument, tout réglage humain serait consigné au nom de
    // `SYSTEME` — une preuve fausse, et le seul motif de ce paramètre.
    await saveSettings(null, formulaire())
    expect(updateSettings).toHaveBeenCalledWith(expect.any(Object), 'u1')
  })
})
