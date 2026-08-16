// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { SetupProposal } from '@/services/dolibarr/setup'

// La server action tirerait `next/cache` et l'authentification : le formulaire
// la reçoit, il ne l'exécute pas ici.
vi.mock('./actions', () => ({ reprendreReglages: vi.fn() }))

import { RepriseReglages } from './RepriseReglages'

function proposition(patch: Partial<SetupProposal> = {}): SetupProposal {
  return {
    debutExerciceMois: { local: 1, dolibarr: 4, divergent: true },
    minutesParJour: {
      local: 480,
      dolibarr: 420,
      divergent: true,
      centiemesAffichesParDolibarr: 114,
    },
    exerciceApresReprise: {
      debut: '2026-04-01',
      fin: '2027-03-31',
      label: 'Exercice 2026-2027',
    },
    reetalonnage: { concernees: 3, verrouillees: 2 },
    ...patch,
  }
}

function texte(): string {
  return document.body.textContent ?? ''
}

afterEach(cleanup)

describe('reprise des réglages Dolibarr — écran', () => {
  it('ne propose rien quand les deux côtés sont déjà alignés', () => {
    render(
      <RepriseReglages
        preview={proposition({
          debutExerciceMois: { local: 4, dolibarr: 4, divergent: false },
          minutesParJour: {
            local: 420,
            dolibarr: 420,
            divergent: false,
            centiemesAffichesParDolibarr: 100,
          },
          exerciceApresReprise: null,
          reetalonnage: { concernees: 0, verrouillees: 0 },
        })}
      />,
    )

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('button')).toBeNull()
    expect(texte()).toContain('correspondent déjà')
  })

  it('propose la reprise de l exercice en annonçant les bornes qui en découlent', () => {
    render(<RepriseReglages preview={proposition()} />)

    const case_ = screen.getByRole('checkbox', { name: /mois de début d’exercice/i })
    expect((case_ as HTMLInputElement).name).toBe('reprendreExercice')
    // Le mois est nommé, pas seulement numéroté : « 4 » ne dit pas avril.
    expect(texte()).toContain('avril')
    expect(texte()).toContain('Exercice 2026-2027')
    expect(texte()).toContain('2026-04-01')
    expect(texte()).toContain('2027-03-31')
    expect(texte()).toContain('objectif de chiffre d’affaires')
  })

  it('avertit que la durée de journée change les objectifs et l affichage à venir', () => {
    render(<RepriseReglages preview={proposition()} />)

    const case_ = screen.getByRole('checkbox', { name: /durée d’une journée/i })
    expect((case_ as HTMLInputElement).name).toBe('reprendreDureeJournee')
    expect(texte()).toContain('7 h')
    expect(texte()).toContain('8 h')
  })

  it('promet que les CRA déjà validés ne sont jamais recalculés', () => {
    // L'exigence la plus ferme du produit. Un écran qui change un réglage doit
    // dire, à l'endroit où on le change, ce qu'il ne changera pas.
    render(<RepriseReglages preview={proposition()} />)

    expect(texte()).toContain('Les CRA déjà validés ne sont jamais recalculés')
  })

  it('présente l écart d affichage comme une convention, jamais comme un temps faux', () => {
    // Les temps poussés voyagent en secondes : huit heures valent 28 800
    // secondes des deux côtés. Seul l'affichage jour/heure de Dolibarr diffère.
    // Un écran qui laisserait croire à un temps faux appellerait une
    // compensation, et une compensation fausserait vraiment les temps.
    render(<RepriseReglages preview={proposition()} />)

    expect(texte()).toContain('1,14 jour')
    expect(texte()).toContain('secondes')
    expect(texte()).toContain('Les temps poussés restent identiques')
  })

  it('propose le réétalonnage des mois ouverts, chiffré', () => {
    render(<RepriseReglages preview={proposition()} />)

    const case_ = screen.getByRole('checkbox', { name: /3 saisie/i })
    expect((case_ as HTMLInputElement).name).toBe('reetalonner')
    expect(texte()).toContain('2 saisie(s) appartiennent à un CRA validé')
  })

  it('n offre pas le réétalonnage quand il ne reste que des saisies verrouillées', () => {
    // L'écran n'offre pas l'option pour les mois validés : il ne se contente
    // pas de la refuser après coup.
    render(
      <RepriseReglages preview={proposition({ reetalonnage: { concernees: 0, verrouillees: 2 } })} />,
    )

    expect(screen.queryByRole('checkbox', { name: /Réétalonner/i })).toBeNull()
    expect(texte()).toContain('ne sont jamais réétalonnées')
  })

  it('n offre pas le réétalonnage quand la durée de journée n est pas en cause', () => {
    render(
      <RepriseReglages
        preview={proposition({
          minutesParJour: {
            local: 420,
            dolibarr: 420,
            divergent: false,
            centiemesAffichesParDolibarr: 100,
          },
          reetalonnage: { concernees: 0, verrouillees: 0 },
        })}
      />,
    )

    expect(screen.queryByRole('checkbox', { name: /durée d’une journée/i })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /Réétalonner/i })).toBeNull()
    expect(screen.getByRole('checkbox', { name: /mois de début d’exercice/i })).toBeTruthy()
  })

  it('porte ses avertissements autrement que par la seule couleur', () => {
    render(<RepriseReglages preview={proposition()} />)

    // `Banner` en tonalité `warning` prend `role="alert"` et un glyphe : le
    // sens ne repose ni sur la teinte du fond, ni sur celle du texte.
    const alertes = screen.getAllByRole('alert')
    expect(alertes.length).toBeGreaterThan(0)
    for (const alerte of alertes) {
      expect((alerte.textContent ?? '').trim().length).toBeGreaterThan(0)
    }
  })

  it('n a qu un seul bouton d envoi, qui dit ce qu il applique', () => {
    render(<RepriseReglages preview={proposition()} />)

    const boutons = screen.getAllByRole('button')
    expect(boutons).toHaveLength(1)
    expect(boutons[0]!.textContent).toContain('Appliquer')
  })
})
