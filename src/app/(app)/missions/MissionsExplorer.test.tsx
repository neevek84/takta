// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { MissionForUser } from '@/services/missions'

vi.mock('./actions', () => ({
  addClient: vi.fn(),
  addMission: vi.fn(),
  addLine: vi.fn(),
  creerMissionDepuisCommande: vi.fn(),
}))
// Les deux formulaires ont leurs propres tests ; ici on vérifie le câblage.
vi.mock('./LigneForm', () => ({ LigneForm: () => <div data-testid="ligne-form" /> }))
vi.mock('./SignataireForm', () => ({ SignataireForm: () => <div data-testid="signataire-form" /> }))

import { MissionsExplorer, type CommandeOuverte } from './MissionsExplorer'

function mission(patch: Partial<MissionForUser> & { id: string }): MissionForUser {
  return {
    label: 'Mission',
    clientId: 'c1',
    clientName: 'SILKHOM',
    minutesParJourEffectif: 420,
    minutesParJourSurcharge: null,
    signataireNom: '',
    signataireEmail: '',
    lines: [],
    ...patch,
  }
}

const MISSIONS: MissionForUser[] = [
  mission({
    id: 'm1',
    label: 'AMOA ITSM',
    lines: [
      {
        id: 'l1',
        label: 'Consultant',
        soldCentiemes: 2000,
        tjmCents: 80000,
        displayUnit: 'JOUR',
        engagementSource: 'DOLIBARR_COMMANDE',
      },
    ],
  }),
  mission({ id: 'm2', label: 'RUN' }),
  mission({ id: 'm3', label: 'Suivi temps', clientId: 'c2', clientName: 'MACERTIF' }),
]

const CLIENTS = [
  { id: 'c1', name: 'SILKHOM' },
  { id: 'c2', name: 'MACERTIF' },
]

const COMMANDES: CommandeOuverte[] = [
  { id: 51, ref: 'CO2410-0002', refClient: '2419', label: '', clientId: 'c1' },
  { id: 52, ref: 'CO2411-0001', refClient: '', label: '', clientId: 'c2' },
]

function rendre(patch: Partial<Parameters<typeof MissionsExplorer>[0]> = {}) {
  render(
    <MissionsExplorer
      missions={MISSIONS}
      clients={CLIENTS}
      heuresParJourDefaut={7}
      commandes={COMMANDES}
      panneDolibarr={null}
      {...patch}
    />,
  )
}

afterEach(cleanup)

describe('MissionsExplorer — la liste', () => {
  it('groupe les missions sous leur client', () => {
    rendre()
    const liste = screen.getByRole('navigation', { name: 'Missions' })

    expect(within(liste).getByRole('heading', { name: 'SILKHOM' })).toBeTruthy()
    expect(within(liste).getByRole('heading', { name: 'MACERTIF' })).toBeTruthy()
    expect(within(liste).getByRole('button', { name: /AMOA ITSM/ })).toBeTruthy()
  })

  it('filtre sur le libellé comme sur le nom du client, sans recharger', () => {
    rendre()
    const liste = screen.getByRole('navigation', { name: 'Missions' })

    fireEvent.change(screen.getByLabelText('Rechercher une mission'), {
      target: { value: 'macertif' },
    })

    expect(within(liste).queryByRole('button', { name: /AMOA ITSM/ })).toBeNull()
    expect(within(liste).getByRole('button', { name: /Suivi temps/ })).toBeTruthy()
  })

  it('le dit quand la recherche ne rend rien, au lieu d’une liste vide muette', () => {
    rendre()
    fireEvent.change(screen.getByLabelText('Rechercher une mission'), {
      target: { value: 'zzz' },
    })
    expect(screen.getByText(/Aucune mission ne correspond/)).toBeTruthy()
  })
})

describe('MissionsExplorer — le détail', () => {
  it('n’affiche qu’une mission à la fois : c’est tout l’objet du maître-détail', () => {
    // Le défaut d'origine : les vingt missions dépliaient leur contenu entier.
    rendre()

    expect(screen.getAllByTestId('signataire-form')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: /SILKHOM · AMOA ITSM/ })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /MACERTIF · Suivi temps/ })).toBeNull()
  })

  it('change de mission sans quitter la page', () => {
    rendre()
    const liste = screen.getByRole('navigation', { name: 'Missions' })

    fireEvent.click(within(liste).getByRole('button', { name: /Suivi temps/ }))

    expect(screen.getByRole('heading', { name: /MACERTIF · Suivi temps/ })).toBeTruthy()
    expect(screen.getAllByTestId('signataire-form')).toHaveLength(1)
  })

  it('nomme la source d’engagement d’une prestation reprise d’une commande', () => {
    rendre()
    expect(screen.getByText(/Engagement : commande Dolibarr/)).toBeTruthy()
  })
})

describe('MissionsExplorer — créer depuis une commande', () => {
  it('ne propose que les commandes du client choisi', () => {
    rendre()
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))

    // Le premier client est sélectionné par défaut.
    expect(screen.getByRole('button', { name: /Créer la mission depuis « CO2410-0002 »/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /CO2411-0001/ })).toBeNull()

    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'c2' } })

    expect(screen.getByRole('button', { name: /Créer la mission depuis « CO2411-0001 »/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /CO2410-0002/ })).toBeNull()
  })

  it('affiche la référence client, et son absence quand il n’y en a pas', () => {
    rendre()
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))
    expect(screen.getByText(/Référence client : 2419/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'c2' } })
    expect(screen.getByText(/Aucune référence client/)).toBeTruthy()
  })

  it('laisse créer à la main quand Dolibarr est en panne, et le dit', () => {
    rendre({ panneDolibarr: 'Dolibarr a répondu 500 sur /orders.' })
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))

    expect(screen.getByText(/Dolibarr a répondu 500 sur \/orders\./)).toBeTruthy()
    // La création manuelle reste atteignable : elle ne dépend pas du connecteur.
    expect(screen.getByLabelText('Nouvelle mission')).toBeTruthy()
  })

  it('ouvre sur la création quand il n’y a encore aucune mission', () => {
    rendre({ missions: [] })
    expect(screen.getByRole('heading', { name: 'Depuis une commande Dolibarr' })).toBeTruthy()
  })
})
