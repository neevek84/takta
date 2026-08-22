// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { OpenConflict } from '@/services/sync/conflicts'
import type { FailedSyncRow } from '@/services/sync/queue'

const {
  requireUser,
  getConnectionState,
  listOpenConflicts,
  listFailedSyncRows,
  listPendingSyncRows,
} = vi.hoisted(
  () => ({
    requireUser: vi.fn(),
    getConnectionState: vi.fn(),
    listOpenConflicts: vi.fn(),
    listFailedSyncRows: vi.fn(),
    listPendingSyncRows: vi.fn(),
  }),
)

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
vi.mock('@/services/google/connect', () => ({ getConnectionState }))
vi.mock('@/services/sync/conflicts', () => ({ listOpenConflicts }))
vi.mock('@/services/sync/queue', () => ({ listFailedSyncRows, listPendingSyncRows }))

// Le client est remplacé par un témoin : ce test porte sur le **câblage** de la
// page, pas sur le rendu du client, qui a ses propres tests.
const recu = vi.hoisted(() => ({ props: null as unknown }))
vi.mock('./SyncClient', () => ({
  SyncClient: (props: unknown) => {
    recu.props = props
    return <div data-testid="client" />
  },
}))

import AdminSyncPage from './page'

const CONNEXION = {
  connected: true,
  calendarId: 'cra@group.calendar.google.com',
  scope: 'calendar',
  connectedAt: new Date('2026-03-01T09:00:00.000Z'),
}

const conflit: OpenConflict = {
  id: 'c1',
  entityId: 'e1',
  kind: 'REMOTE_MODIFIED',
  detectedAt: new Date('2026-03-20T10:00:00.000Z'),
  libelle: '2026-03-12 · ACME · ITSM · Consultant',
  remote: null,
}

const echec: FailedSyncRow = {
  id: 'r1',
  entityId: 'e2',
  entityType: 'TimeEntry',
  provider: 'GOOGLE',
  operation: 'UPSERT',
  attempts: 5,
  lastError: 'Agenda injoignable : fetch failed',
  libelle: '2026-03-13 · ACME · ITSM · Consultant',
}

beforeEach(() => {
  recu.props = null
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  getConnectionState.mockReset().mockResolvedValue(CONNEXION)
  listOpenConflicts.mockReset().mockResolvedValue([conflit])
  listFailedSyncRows.mockReset().mockResolvedValue([echec])
  listPendingSyncRows.mockReset().mockResolvedValue([])
})
afterEach(cleanup)

describe('page Administration · Synchronisation', () => {
  it('donne au client ce que les services rendent, pour l utilisateur de la session', async () => {
    render(await AdminSyncPage({ searchParams: Promise.resolve({}) }))

    // La lecture est scopée par l'identifiant de la session : une page qui
    // lirait sans le passer montrerait les divergences de tout le monde.
    expect(getConnectionState).toHaveBeenCalledWith('u1')
    expect(listOpenConflicts).toHaveBeenCalledWith('u1')
    expect(listFailedSyncRows).toHaveBeenCalledWith('u1')
    // La file en attente est lue pour **toute l'instance** : un CRA appartient
    // à une mission, et le pousser est un acte d'instance. Arbitrage du
    // porteur, 20 août 2026 ; les rôles poseront la restriction.
    expect(listPendingSyncRows).toHaveBeenCalledWith()

    // Et elle les transmet : un écran câblé sur des tableaux vides afficherait
    // « aucune divergence » pendant qu'une divergence attend en base.
    expect(recu.props).toEqual({
      connection: CONNEXION,
      conflicts: [conflit],
      failures: [echec],
      pending: [],
    })
    expect(screen.getByTestId('client')).toBeTruthy()
  })

  it('n annonce rien quand la redirection ne porte aucun message', async () => {
    render(await AdminSyncPage({ searchParams: Promise.resolve({}) }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('affiche le message rapporté par la redirection de connexion', async () => {
    render(
      await AdminSyncPage({
        searchParams: Promise.resolve({ message: 'Agenda connecté.', tone: 'success' }),
      }),
    )
    expect(screen.getByRole('status').textContent).toContain('Agenda connecté.')
  })
})

describe('la tonalité du retour de connexion', () => {
  // Cet écran affichait TOUT retour à l'identique, refus compris : « Connexion
  // Google refusée » avait exactement l'apparence de « Google Calendar est
  // connecté ». La tonalité voyage désormais avec le message, de bout en bout.
  it('annonce un refus comme un refus, pas comme un succès', async () => {
    render(
      await AdminSyncPage({
        searchParams: Promise.resolve({ message: 'Connexion Google refusée.', tone: 'danger' }),
      }),
    )

    // `alert` interrompt ; `status` attend. Un refus rendu en `status` est
    // exactement le défaut d'origine.
    const bandeau = screen.getByRole('alert')
    expect(bandeau.textContent).toContain('Connexion Google refusée.')
    // L'information n'est pas portée par la seule couleur : le bandeau porte
    // une icône propre à sa tonalité.
    expect(bandeau.querySelector('svg[data-icone="danger"]')).not.toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('ne laisse pas une tonalité absente ou forgée passer pour un succès', async () => {
    for (const tone of [undefined, 'vert', 'SUCCESS']) {
      cleanup()
      render(
        await AdminSyncPage({
          searchParams: Promise.resolve({
            message: 'Message sans tonalité.',
            ...(tone === undefined ? {} : { tone }),
          }),
        }),
      )
      // Repli sur l'avertissement : rien ne doit pouvoir se faire passer pour
      // une réussite en omettant simplement le paramètre.
      const bandeau = screen.getByRole('alert')
      expect(bandeau.querySelector('svg[data-icone="avertissement"]'), String(tone)).not.toBeNull()
      expect(bandeau.querySelector('svg[data-icone="succes"]'), String(tone)).toBeNull()
    }
  })
})
