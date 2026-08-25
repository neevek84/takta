// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { MissionForUser } from '@/services/missions'

vi.mock('./actions', () => ({
  addClient: vi.fn(),
  addMission: vi.fn(),
  addLine: vi.fn(),
  creerMissionDepuisCommande: vi.fn(),
  // `RenamePrestation` s'en sert directement, sans passer par `LigneForm` :
  // c'est le seul autre appel de ce module que la page atteint.
  modifierLigne: vi.fn().mockResolvedValue({ ok: true }),
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
    dolibarrProjectId: null,
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
        dolibarrTaskId: 51,
      },
    ],
  }),
  mission({ id: 'm2', label: 'RUN' }),
  mission({ id: 'm3', label: 'Suivi temps', clientId: 'c2', clientName: 'MACERTIF' }),
]

const PROJETS = [
  { id: 46, ref: 'PJ2511-0033', title: 'GUICHET UNIQUE', socid: 7, missionId: null },
  // Déjà suivi : le proposer ferait partir deux CRA vers les mêmes tâches.
  { id: 47, ref: 'PJ2511-0034', title: 'RUN', socid: 7, missionId: 'm2' },
  // Autre tiers : le service le refuserait, le proposer n'inviterait qu'au refus.
  { id: 49, ref: 'PJ2605-0036', title: 'I26-EPM', socid: 9, missionId: null },
]

/**
 * Le tiers de chaque client, lu pour lui-même. `c2` n'a **aucune commande** :
 * ses projets doivent quand même être proposés.
 */
const TIERS_PAR_CLIENT = [
  { clientId: 'c1', socid: 7 },
  { clientId: 'c2', socid: 9 },
]

const CLIENTS = [
  { id: 'c1', name: 'SILKHOM' },
  { id: 'c2', name: 'MACERTIF' },
]

const COMMANDES: CommandeOuverte[] = [
  {
    id: 51,
    ref: 'CO2410-0002',
    refClient: '2419',
    label: '',
    socid: 7,
    thirdpartyName: 'SILKHOM',
    clientId: 'c1',
    projectId: null,
    missionId: null,
    missionLabel: null,
  },
  {
    id: 52,
    ref: 'CO2411-0001',
    refClient: '',
    label: '',
    socid: 9,
    // Ce tiers n'est rattaché à aucun client local : l'écran doit quand même
    // le proposer, sans quoi il faut passer par les réglages pour revenir ici.
    thirdpartyName: 'MACERTIF',
    clientId: null,
    // Elle porte déjà un projet créé à la main dans Dolibarr : c'est le cas
    // normal du porteur, et la masquer la rendait introuvable.
    projectId: 49,
    missionId: null,
    missionLabel: null,
  },
]

function rendre(patch: Partial<Parameters<typeof MissionsExplorer>[0]> = {}) {
  render(
    <MissionsExplorer
      missions={MISSIONS}
      clients={CLIENTS}
      heuresParJourDefaut={7}
      commandes={COMMANDES}
      projets={PROJETS}
      tiersParClient={TIERS_PAR_CLIENT}
      dolibarrActif={true}
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

describe('MissionsExplorer — d’où vient chaque chose', () => {
  it('dit qu’une mission sans projet est locale, et pourquoi ça compte', async () => {
    // Une mission sans projet ne pousse jamais rien, et on ne s'en apercevait
    // qu'au premier CRA validé qui n'arrivait pas.
    rendre()
    const liste = screen.getByRole('navigation', { name: 'Missions' })

    expect(within(liste).getAllByLabelText('Local').length).toBeGreaterThan(0)
    expect(
      screen.getByLabelText(/Local — aucun projet Dolibarr/),
    ).toBeTruthy()
  })

  it('nomme le projet quand la mission en porte un', () => {
    rendre({ missions: [mission({ id: 'm1', label: 'AMOA', dolibarrProjectId: 46 })] })
    expect(screen.getByLabelText('Dolibarr — projet PJ2511-0033')).toBeTruthy()
  })

  it('retombe sur le numéro quand le projet n’est pas dans la liste', () => {
    // Dolibarr en panne : la liste des projets est vide, mais la mission reste
    // rattachée — le dire « Local » serait faux.
    rendre({
      missions: [mission({ id: 'm1', dolibarrProjectId: 999 })],
      projets: [],
    })
    expect(screen.getByLabelText('Dolibarr — projet n° 999')).toBeTruthy()
  })

  it('distingue une prestation avec tâche d’une prestation sans', () => {
    rendre({
      missions: [
        mission({
          id: 'm1',
          lines: [
            {
              id: 'l1',
              label: 'Avec',
              soldCentiemes: 100,
              tjmCents: 0,
              displayUnit: 'JOUR',
              engagementSource: 'MANUEL',
              dolibarrTaskId: 51,
            },
            {
              id: 'l2',
              label: 'Sans',
              soldCentiemes: 100,
              tjmCents: 0,
              displayUnit: 'JOUR',
              engagementSource: 'MANUEL',
              dolibarrTaskId: null,
            },
          ],
        }),
      ],
    })

    expect(screen.getByLabelText('Dolibarr — tâche n° 51')).toBeTruthy()
    expect(screen.getByLabelText(/Local — aucune tâche Dolibarr/)).toBeTruthy()
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
  it('propose les tiers Dolibarr, y compris ceux sans client local', () => {
    // Le défaut : le sélecteur ne portait que les clients locaux. Un tiers
    // Dolibarr non rattaché n'apparaissait nulle part dans la page où l'on
    // crée la mission, et il fallait aller le rattacher dans les réglages.
    rendre()
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))

    const choix = screen.getByLabelText('Client Dolibarr') as HTMLSelectElement
    const options = Array.from(choix.options).map((o) => o.textContent)
    expect(options[0]).toContain('SILKHOM')
    expect(options[1]).toContain('MACERTIF')
    expect(options[1]).toContain('client local à créer')
  })

  it('ne propose que les commandes du tiers choisi', () => {
    rendre()
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))

    expect(screen.getByRole('button', { name: /Créer la mission depuis « CO2410-0002 »/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /CO2411-0001/ })).toBeNull()

    fireEvent.change(screen.getByLabelText('Client Dolibarr'), { target: { value: '9' } })

    expect(screen.getByRole('button', { name: /Créer la mission depuis « CO2411-0001 »/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /CO2410-0002/ })).toBeNull()
  })

  it('propose une commande qui porte déjà un projet, en disant ce qui se passera', () => {
    // Le défaut mesuré sur l'instance du porteur : ses deux seules commandes en
    // cours pointaient chacune vers un projet créé à la main, et n'apparaissaient
    // donc nulle part. Or c'est le cas normal — le projet existe, la mission
    // manque.
    rendre()
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))
    fireEvent.change(screen.getByLabelText('Client Dolibarr'), { target: { value: '9' } })

    expect(screen.getByRole('button', { name: /Créer la mission depuis « CO2411-0001 »/ })).toBeTruthy()
    expect(screen.getByText(/porte déjà un projet Dolibarr/)).toBeTruthy()
  })

  it('ne propose pas de doubler une mission qui suit déjà ce projet', () => {
    // Deux missions sur le même projet feraient partir deux CRA vers les mêmes
    // tâches.
    rendre({
      commandes: [{ ...COMMANDES[1]!, missionId: 'm9', missionLabel: 'Guichet unique' }],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))

    expect(screen.queryByRole('button', { name: /Créer la mission depuis/ })).toBeNull()
    expect(screen.getByText(/déjà suivi par la mission « Guichet unique »/)).toBeTruthy()
  })

  it('affiche la référence client, et son absence quand il n’y en a pas', () => {
    rendre()
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))
    expect(screen.getByText(/Référence client : 2419/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Client Dolibarr'), { target: { value: '9' } })
    expect(screen.getByText(/Aucune référence client/)).toBeTruthy()
  })

  it('laisse créer à la main quand Dolibarr est en panne, et le dit', () => {
    rendre({ panneDolibarr: 'Dolibarr a répondu 500 sur /orders.' })
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))

    expect(screen.getByText(/Dolibarr a répondu 500 sur \/orders\./)).toBeTruthy()
    // La création manuelle reste atteignable : elle ne dépend pas du connecteur.
    expect(screen.getByLabelText('Nouvelle mission')).toBeTruthy()
  })

  it('offre les trois voies : aucun projet, en créer un, ou rattacher', () => {
    // Une mission sans projet ne pousse jamais rien, et le rattachement se
    // faisait plus tard, dans les réglages, quand on y pensait.
    rendre()
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))

    const choix = screen.getByLabelText('Projet Dolibarr') as HTMLSelectElement
    const options = Array.from(choix.options).map((o) => o.textContent)
    expect(options[0]).toContain('Aucun')
    expect(options[1]).toContain('Créer un projet')
    // Le projet du tiers du client choisi, et lui seul.
    expect(options[2]).toContain('PJ2511-0033')
    expect(options).toHaveLength(3)
  })

  it('n’offre pas un projet déjà suivi, ni celui d’un autre tiers', () => {
    // Deux missions sur un même projet feraient partir deux CRA vers les mêmes
    // tâches ; un projet d'un autre tiers serait de toute façon refusé.
    rendre()
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))
    const rendu = (screen.getByLabelText('Projet Dolibarr') as HTMLSelectElement).innerHTML

    expect(rendu).not.toContain('PJ2511-0034')
    expect(rendu).not.toContain('PJ2605-0036')
  })

  it('propose les projets d’un client qui n’a aucune commande', () => {
    // Le tiers se déduisait des commandes : un client sans commande en cours
    // n'apparaissait nulle part, et ses projets non plus — impossible de
    // rattacher une mission à un projet né d'aucun bon de commande.
    rendre({ commandes: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))

    // Le formulaire manuel vise `c1` par défaut ; son projet doit être offert.
    const choix = screen.getByLabelText('Projet Dolibarr') as HTMLSelectElement
    expect(Array.from(choix.options).map((o) => o.textContent).join(' ')).toContain('PJ2511-0033')
  })

  it('ne propose aucun projet quand Dolibarr n’est pas connecté', () => {
    rendre({ dolibarrActif: false })
    fireEvent.click(screen.getByRole('button', { name: 'Nouvelle mission' }))
    expect(screen.queryByLabelText('Projet Dolibarr')).toBeNull()
  })

  it('ouvre sur la création quand il n’y a encore aucune mission', () => {
    rendre({ missions: [] })
    expect(screen.getByRole('heading', { name: 'Depuis une commande Dolibarr' })).toBeTruthy()
  })
})
