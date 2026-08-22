// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import type { ImportCandidates } from '@/services/dolibarr/import'

const {
  requireUser,
  getInstanceCredential,
  getDolibarrApi,
  listImportCandidates,
  listClients,
  listMissionsForUser,
  previewDolibarrSetup,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getInstanceCredential: vi.fn(),
  getDolibarrApi: vi.fn(),
  listImportCandidates: vi.fn(),
  listClients: vi.fn(),
  listMissionsForUser: vi.fn(),
  previewDolibarrSetup: vi.fn(),
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
vi.mock('@/services/credentials', () => ({ getInstanceCredential }))
vi.mock('@/services/dolibarr/resolve', () => ({ getDolibarrApi }))
vi.mock('@/services/dolibarr/import', () => ({ listImportCandidates }))
vi.mock('@/services/clients', () => ({ listClients }))
vi.mock('@/services/missions', () => ({ listMissionsForUser }))
vi.mock('@/services/dolibarr/setup', () => ({ previewDolibarrSetup }))
// Les server actions tireraient `next/cache` et l'authentification : le
// formulaire les reçoit, il ne les exécute pas ici.
vi.mock('./actions', () => ({
  rattacherTiers: vi.fn(),
  rattacherProjet: vi.fn(),
  detacher: vi.fn(),
  pousserClient: vi.fn(),
  reprendreReglages: vi.fn(),
}))

// Témoin : ce test porte sur le **câblage** de la page, pas sur le rendu du
// formulaire de connexion, qui a ses propres tests.
const recu = vi.hoisted(() => ({ props: null as unknown }))
vi.mock('./ConnexionForm', () => ({
  ConnexionForm: (props: unknown) => {
    recu.props = props
    return <div data-testid="connexion" />
  },
}))

import AdminDolibarrPage from './page'

const API = { marqueur: 'api' }

const CANDIDATS: ImportCandidates = {
  tiers: [
    { id: 1, name: 'ACME distant', clientId: null, clientName: null },
    { id: 2, name: 'BETA distant', clientId: 'c9', clientName: 'BETA local' },
  ],
  projets: [
    { id: 10, ref: 'PJ001', title: 'ITSM distant', socid: 1, missionId: null, missionLabel: null },
    {
      id: 11,
      ref: 'PJ002',
      title: 'RUN distant',
      socid: 2,
      missionId: 'm9',
      missionLabel: 'RUN local',
    },
  ],
}

const CREDENTIAL = {
  provider: 'DOLIBARR',
  baseUrl: 'https://erp.invalid/api/index.php',
  metadata: {},
  connectedAt: new Date('2026-08-15T08:00:00.000Z'),
}

/**
 * Aperçu par défaut : les deux côtés sont alignés, donc l'écran ne propose
 * aucune reprise. C'est le cas neutre — les tests qui portent sur autre chose
 * n'ont pas à composer avec un formulaire de reprise qu'ils n'ont pas demandé.
 */
const ALIGNE = {
  debutExerciceMois: { local: 4, dolibarr: 4, divergent: false },
  minutesParJour: {
    local: 420,
    dolibarr: 420,
    divergent: false,
    centiemesAffichesParDolibarr: 100,
  },
  exerciceApresReprise: null,
  reetalonnage: { concernees: 0, verrouillees: 0 },
}

/** L'instance du porteur : exercice d'avril, journée de 7 h contre 8 h ici. */
const DIVERGENT = {
  debutExerciceMois: { local: 1, dolibarr: 4, divergent: true },
  minutesParJour: {
    local: 480,
    dolibarr: 420,
    divergent: true,
    centiemesAffichesParDolibarr: 114,
  },
  exerciceApresReprise: { debut: '2026-04-01', fin: '2027-03-31', label: 'Exercice 2026-2027' },
  reetalonnage: { concernees: 2, verrouillees: 1 },
}

const MISSIONS = [
  {
    id: 'm1',
    label: 'ITSM local',
    clientName: 'ACME local',
    minutesParJourEffectif: 480,
    minutesParJourSurcharge: null,
    lines: [],
  },
]

beforeEach(() => {
  recu.props = null
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  getInstanceCredential.mockReset().mockResolvedValue(CREDENTIAL)
  getDolibarrApi.mockReset().mockResolvedValue(API)
  listImportCandidates.mockReset().mockResolvedValue(CANDIDATS)
  listClients.mockReset().mockResolvedValue([{ id: 'c1', name: 'ACME local' }])
  listMissionsForUser.mockReset().mockResolvedValue(MISSIONS)
  previewDolibarrSetup.mockReset().mockResolvedValue(ALIGNE)
})
afterEach(cleanup)

async function rendre(params: { message?: string; tone?: string } = {}) {
  render(await AdminDolibarrPage({ searchParams: Promise.resolve(params) }))
}

describe('page Administration · Dolibarr — câblage', () => {
  it('lit les identifiants d instance et les transmet au formulaire, sans secret', async () => {
    await rendre()

    expect(getInstanceCredential).toHaveBeenCalledWith('DOLIBARR')
    expect(recu.props).toEqual({
      // Le formulaire reçoit l'adresse de l'instance, pas la base d'API
      // enregistrée : ce qu'il réaffiche doit être ce qu'il accepte.
      instanceUrl: 'https://erp.invalid',
      connecte: true,
      connectedAt: CREDENTIAL.connectedAt,
    })
    // Le secret n'a aucune raison de traverser la page : la vue n'en porte pas.
    expect(Object.keys(recu.props as object)).not.toContain('apiKey')
  })

  it('dit au formulaire que Dolibarr n est pas connecté quand aucune clé n existe', async () => {
    getInstanceCredential.mockResolvedValue(null)
    getDolibarrApi.mockResolvedValue(null)

    await rendre()

    expect(recu.props).toEqual({
      instanceUrl: '',
      connecte: false,
      connectedAt: null,
    })
  })

  it('interroge Dolibarr pour la session, et affiche ce qu il rend', async () => {
    await rendre()

    expect(listImportCandidates).toHaveBeenCalledWith('u1', API)
    // Câblée sur un tableau vide, la page annoncerait « rien à rattacher »
    // pendant que l'instance propose des tiers.
    expect(screen.getByText('ACME distant')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rattacher « ACME distant »' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rattacher « PJ001 »' })).toBeTruthy()
  })

  it('propose les clients et les missions de la session comme cibles', async () => {
    await rendre()

    expect(listClients).toHaveBeenCalledWith('u1')
    expect(listMissionsForUser).toHaveBeenCalledWith('u1')

    const rattachement = screen.getByLabelText('Client local pour « ACME distant »')
    expect(within(rattachement).getByRole('option', { name: /ACME local/ })).toBeTruthy()

    const mission = screen.getByLabelText('Mission locale pour « PJ001 »')
    expect(within(mission).getByRole('option', { name: /ITSM local/ })).toBeTruthy()
  })

  it('signale ce qui est déjà rattaché et propose de le détacher', async () => {
    await rendre()

    expect(screen.getByText(/BETA local/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Détacher « BETA distant »' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Détacher « PJ002 »' })).toBeTruthy()
    // Ce qui est rattaché ne propose plus de l'être une seconde fois.
    expect(screen.queryByLabelText('Client local pour « BETA distant »')).toBeNull()
  })

  it('ne propose pas de créer une mission tant qu aucun client local n existe', async () => {
    // Sans client, la création échouerait sur la clé étrangère : mieux vaut
    // dire par où commencer que laisser un bouton qui ne fait rien.
    listClients.mockResolvedValue([])

    await rendre()

    expect(screen.queryByLabelText('Mission locale pour « PJ001 »')).toBeNull()
    expect(document.body.textContent ?? '').toContain(
      'Rattachez d’abord un tiers pour obtenir un client local',
    )
  })

  it('ne touche pas Dolibarr quand il n est pas connecté, et reste utilisable', async () => {
    getDolibarrApi.mockResolvedValue(null)

    await rendre()

    expect(listImportCandidates).not.toHaveBeenCalled()
    expect(screen.getByTestId('connexion')).toBeTruthy()
  })

  it('reste debout quand Dolibarr est en panne, et le dit', async () => {
    // La page porte le formulaire de connexion : c'est justement l'écran
    // qu'on veut atteindre quand la connexion ne marche pas.
    listImportCandidates.mockRejectedValue(new Error('Dolibarr est injoignable (/projects).'))

    await rendre()

    const alerte = screen.getByRole('alert')
    expect(alerte.textContent).toContain('injoignable')
    expect(alerte.textContent).toContain('La saisie et la validation des CRA fonctionnent')
    expect(screen.getByTestId('connexion')).toBeTruthy()
    expect(screen.queryByText('ACME distant')).toBeNull()
  })

  it('affiche le message rapporté par une action', async () => {
    await rendre({ message: 'Le tiers a été créé dans Dolibarr.' })
    expect(screen.getByRole('status').textContent).toContain('Le tiers a été créé dans Dolibarr.')
  })

  it('n annonce rien quand aucune action n a laissé de message', async () => {
    await rendre()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('affiche un refus de rattachement en alerte, pas en succès', async () => {
    // Le danger fermé par cette tâche : un refus rendu avec le glyphe et le
    // rôle d'un succès contredirait le texte qu'il porte. `tone=danger`
    // bascule le bandeau en alerte.
    await rendre({
      message:
        'Le projet « PJ001 » appartient au tiers Dolibarr n° 5, mais « ACME » est rattaché au tiers Dolibarr n° 7.',
      tone: 'danger',
    })

    const alerte = screen.getByRole('alert')
    expect(alerte.textContent).toContain('PJ001')
    expect(alerte.textContent).toContain('tiers Dolibarr n° 5')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('propose un projet avec sa référence et son tiers en champs cachés', async () => {
    // `rattacherProjet` a besoin de ces deux valeurs pour vérifier la
    // cohérence du tiers ; l'écran est leur seule source, Dolibarr n'étant
    // pas rappelé à l'action.
    await rendre()

    const bouton = screen.getByRole('button', { name: 'Rattacher « PJ001 »' })
    const formulaire = bouton.closest('form')
    expect(formulaire).not.toBeNull()
    const champRef = formulaire!.querySelector('input[name="ref"]') as HTMLInputElement | null
    const champSocid = formulaire!.querySelector('input[name="socid"]') as HTMLInputElement | null
    expect(champRef?.value).toBe('PJ001')
    expect(champSocid?.value).toBe('1')
  })
})

describe('page Administration · Dolibarr — reprise des réglages', () => {
  it('interroge les réglages de l instance pour la session', async () => {
    await rendre()

    expect(previewDolibarrSetup).toHaveBeenCalledWith({ userId: 'u1', api: API })
  })

  it('propose de reprendre ce qui diverge, avec ses conséquences annoncées', async () => {
    previewDolibarrSetup.mockResolvedValue(DIVERGENT)

    await rendre()

    expect(screen.getByRole('checkbox', { name: /mois de début d’exercice/i })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: /durée d’une journée/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Appliquer la reprise/i })).toBeTruthy()
    // La promesse tenue par le lot, écrite là où le réglage se change.
    expect(document.body.textContent ?? '').toContain(
      'Les CRA déjà validés ne sont jamais recalculés',
    )
  })

  it('ne propose rien quand les deux côtés sont déjà alignés', async () => {
    await rendre()

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(document.body.textContent ?? '').toContain('correspondent déjà')
  })

  it('ne lit aucun réglage quand Dolibarr n est pas connecté', async () => {
    getDolibarrApi.mockResolvedValue(null)

    await rendre()

    expect(previewDolibarrSetup).not.toHaveBeenCalled()
    expect(screen.getByTestId('connexion')).toBeTruthy()
  })

  it('reste utilisable quand les réglages ne se lisent pas, et le dit', async () => {
    // Une panne de Dolibarr ne bloque jamais l'application : l'écran annonce
    // qu'il n'a rien pu lire plutôt que d'afficher « déjà aligné ».
    previewDolibarrSetup.mockRejectedValue(new Error('Dolibarr est injoignable (/setup).'))

    await rendre()

    const alerte = screen.getByRole('alert')
    expect(alerte.textContent).toContain('injoignable')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByText('correspondent déjà')).toBeNull()
    expect(screen.getByTestId('connexion')).toBeTruthy()
  })
})
