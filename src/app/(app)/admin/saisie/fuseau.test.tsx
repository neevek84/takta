// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Le fuseau quitte `CRA_TIMEZONE` pour l'écran des réglages. Fichier à part :
// `SettingsForm.test.tsx` et `actions.test.ts` sont touchés par d'autres lots.

const { requireUser, updateSettings, recalibrateOpenMonths, revalidatePath } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  updateSettings: vi.fn(),
  recalibrateOpenMonths: vi.fn(),
  revalidatePath: vi.fn(),
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
vi.mock('@/services/rates', () => ({ recalibrateOpenMonths }))
vi.mock('@/services/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/settings')>()),
  updateSettings,
  loadFrenchHolidays: vi.fn(),
}))

import { saveSettings } from './actions'
import { SettingsForm } from './SettingsForm'
import { DEFAULT_SLOTS } from '@/services/settings'

const REGLAGES = {
  minutesParJour: 480,
  capacityMode: 'AVERTISSEMENT' as const,
  capacityCentiemes: 100,
  workingDays: [1, 2, 3, 4, 5],
  slots: DEFAULT_SLOTS,
  holidays: [],
  defaultDisplayUnit: 'JOUR' as const,
  defaultEngagementSource: 'MANUEL' as const,
  objectifCaExerciceCents: 0,
  debutExerciceMois: 1,
  journeeDebutMinute: 540,
  journeeFinMinute: 1080,
  relanceJours: 7,
  timeZone: 'Indian/Reunion',
}

/** Le formulaire complet, tel que la page l'envoie. */
function formulaire(valeurs: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const base: Record<string, string> = {
    heures: '8',
    minutes: '0',
    capacityMode: 'AVERTISSEMENT',
    capaciteJours: '1',
    slotsJson: JSON.stringify(DEFAULT_SLOTS),
    defaultDisplayUnit: 'JOUR',
    defaultEngagementSource: 'MANUEL',
    objectifCaEuros: '0',
    debutExerciceMois: '1',
    journeeDebut: '09:00',
    journeeFin: '18:00',
    timeZone: 'Indian/Reunion',
    ...valeurs,
  }
  for (const [cle, valeur] of Object.entries(base)) fd.set(cle, valeur)
  fd.append('workingDays', '1')
  return fd
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  updateSettings.mockReset().mockResolvedValue(REGLAGES)
  recalibrateOpenMonths.mockReset()
  revalidatePath.mockReset()
})

afterEach(cleanup)

describe('le fuseau se règle à l écran', () => {
  it('affiche le fuseau courant dans un champ modifiable', () => {
    render(<SettingsForm settings={REGLAGES} preview={{ concernees: 0, verrouillees: 0 }} />)

    const champ = screen.getByLabelText(/fuseau horaire/i) as HTMLInputElement
    expect(champ.value).toBe('Indian/Reunion')
    expect(champ.name).toBe('timeZone')
  })

  it('dit que le défaut est celui de la machine', () => {
    // Personne ne devrait avoir à déclarer qu'il vit à Paris — et surtout pas
    // dans un fichier.
    render(<SettingsForm settings={REGLAGES} preview={{ concernees: 0, verrouillees: 0 }} />)
    expect(document.body.textContent).toContain('celui de cette machine')
  })

  it('transmet le fuseau saisi au service', async () => {
    await saveSettings(null, formulaire({ timeZone: 'America/Guadeloupe' }))

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ timeZone: 'America/Guadeloupe' }),
      'u1',
    )
  })

  it('n invente pas de fuseau quand le champ est vide : le service tranche', async () => {
    // L'action transcrit, elle ne valide pas. Un repli discret sur
    // `Europe/Paris` ou sur `CRA_TIMEZONE` posé ici rendrait le refus du
    // service inatteignable.
    await saveSettings(null, formulaire({ timeZone: '' }))

    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ timeZone: '' }),
      'u1',
    )
  })

  it('exige une session', async () => {
    requireUser.mockRejectedValue(new Error('non authentifié'))

    await expect(saveSettings(null, formulaire())).rejects.toThrow()
    expect(updateSettings).not.toHaveBeenCalled()
  })
})
