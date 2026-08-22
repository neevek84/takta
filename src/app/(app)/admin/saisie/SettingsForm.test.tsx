// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { AppSettings } from '@/services/settings'
import { DEFAULT_SLOTS } from '@/services/settings'

const { saveSettings, lancerReetalonnage } = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  lancerReetalonnage: vi.fn(),
}))
vi.mock('./actions', () => ({ saveSettings, lancerReetalonnage }))

// `vi.mock` est hissé au-dessus des imports : la server action n'est jamais
// chargée (elle tirerait `next/cache` et l'authentification), seul le
// composant l'est.
import { SettingsForm } from './SettingsForm'

const REGLAGES: AppSettings = {
  minutesParJour: 480,
  capacityMode: 'AVERTISSEMENT',
  capacityCentiemes: 100,
  workingDays: [1, 2, 3, 4, 5],
  slots: DEFAULT_SLOTS,
  holidays: [],
  defaultDisplayUnit: 'JOUR',
  defaultEngagementSource: 'MANUEL',
  objectifCaExerciceCents: 0,
  debutExerciceMois: 1,
  journeeDebutMinute: 540,
  journeeFinMinute: 1080,
  relanceJours: 7,
  timeZone: 'Europe/Paris',
}

beforeEach(() => {
  saveSettings.mockReset().mockResolvedValue({ ok: true })
  lancerReetalonnage.mockReset().mockResolvedValue({ concernees: 0, verrouillees: 0 })
})
afterEach(cleanup)

function rendre(patch: Partial<AppSettings> = {}) {
  render(
    <SettingsForm
      settings={{ ...REGLAGES, ...patch }}
      preview={{ concernees: 0, verrouillees: 0 }}
    />,
  )
}

/** Le bloc « Plage journée » : les créneaux portent eux aussi des champs
 *  « Début » et « Fin », la recherche par libellé doit donc être bornée. */
function blocPlageJournee(): HTMLElement {
  const legende = screen.getByText('Plage journée')
  const bloc = legende.closest('fieldset')
  if (!bloc) throw new Error('bloc « Plage journée » introuvable')
  return bloc
}

describe('SettingsForm — plage journée', () => {
  it('affiche la plage en heures lisibles', () => {
    rendre({ journeeDebutMinute: 480, journeeFinMinute: 960 })
    const bloc = within(blocPlageJournee())
    const debut = bloc.getByLabelText('Début') as HTMLInputElement
    const fin = bloc.getByLabelText('Fin') as HTMLInputElement
    expect({ debut: debut.value, fin: fin.value }).toEqual({ debut: '08:00', fin: '16:00' })
  })

  it('transmet la plage à la server action sous les noms qu elle relit', async () => {
    // Ce test tient la couture entre le formulaire et `actions.ts` : renommer
    // un champ d'un côté seulement fait taire l'enregistrement de la plage
    // sans qu'aucune erreur ne remonte à l'utilisateur.
    rendre()
    const form = document.querySelector('form')
    if (!form) throw new Error('formulaire introuvable')
    fireEvent.submit(form)

    await waitFor(() => expect(saveSettings).toHaveBeenCalled())
    const formData = saveSettings.mock.calls[0]![1] as FormData
    expect({
      debut: formData.get('journeeDebut'),
      fin: formData.get('journeeFin'),
    }).toEqual({ debut: '09:00', fin: '18:00' })
  })
})

describe('le menu des sources d’engagement', () => {
  // Le menu proposait **quatre** lignes dont une vide : la table de libellés
  // vivait dans cet écran en `Record<string, string>`, et l'arrivée de la
  // commande n'y avait rien ajouté. Le typage ne bronchait pas, l'écran
  // affichait un trou — sélectionnable, et muet sur ce qu'il engageait.
  it('nomme les quatre sources, sans ligne vide', () => {
    rendre()

    const menu = screen.getByLabelText('Source') as HTMLSelectElement
    const libelles = [...menu.options].map((o) => o.textContent?.trim() ?? '')

    expect(libelles).toEqual([
      'Manuel',
      'Propale Dolibarr',
      'Commande Dolibarr',
      'Projet Dolibarr',
    ])
    expect(libelles.every((l) => l !== '')).toBe(true)
  })
})

