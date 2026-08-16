// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { AuditEntry } from '@/services/audit'
import type { JobView } from '@/services/jobs/scheduler'
import type { Alerte, Ordonnanceur } from '@/services/supervision'

const { requireUser, listAlertes, readOrdonnanceur, listJobs, listAuditEvents } = vi.hoisted(
  () => ({
    requireUser: vi.fn(),
    listAlertes: vi.fn(),
    readOrdonnanceur: vi.fn(),
    listJobs: vi.fn(),
    listAuditEvents: vi.fn(),
  }),
)

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('@/services/supervision', () => ({ listAlertes, readOrdonnanceur }))
vi.mock('@/services/jobs/scheduler', () => ({ listJobs }))
vi.mock('@/services/audit', () => ({ listAuditEvents }))

// Les panneaux sont remplacés par des témoins : ce test porte sur le
// **câblage** de la page, pas sur leur rendu, qui a ses propres tests.
const recu = vi.hoisted(() => ({ alertes: null as unknown, travaux: null as unknown }))
vi.mock('./AlertesPanel', () => ({
  AlertesPanel: (props: unknown) => {
    recu.alertes = props
    return <div data-testid="alertes" />
  },
}))
vi.mock('./TravauxPanel', () => ({
  TravauxPanel: (props: unknown) => {
    recu.travaux = props
    return <div data-testid="travaux" />
  },
}))

import SupervisionPage from './page'

const ALERTE: Alerte = { code: 'TRAVAIL_ECHEC', libelle: 'Travail en échec : X', detail: 'boum' }

const TRAVAIL: JobView = {
  name: 'webhooks.distribute',
  label: 'Distribution des rappels sortants',
  intervalMinutes: 5,
  enabled: true,
  disponible: true,
  lastRunAt: new Date('2026-08-15T09:55:00.000Z'),
  nextRunAt: new Date('2026-08-15T10:00:00.000Z'),
  lastState: 'SUCCES',
  lastError: '',
  enCoursDepuis: null,
}

const ORDONNANCEUR: Ordonnanceur = {
  proprietaireId: 'u1',
  proprietaireLabel: 'Keveen',
  autreCompte: false,
  comptes: 1,
}

const ENTREE: AuditEntry = {
  seq: 412,
  occurredAt: new Date('2026-08-15T09:30:00.000Z'),
  actorId: 'u1',
  actorLabel: 'Keveen',
  action: 'cra.valide',
  entityType: 'Cra',
  entityId: 'cra-1',
  payload: { mois: '2026-07' },
  prevHash: 'a',
  hash: 'b',
}

beforeEach(() => {
  recu.alertes = null
  recu.travaux = null
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  listAlertes.mockReset().mockResolvedValue([ALERTE])
  readOrdonnanceur.mockReset().mockResolvedValue(ORDONNANCEUR)
  listJobs.mockReset().mockResolvedValue([TRAVAIL])
  listAuditEvents.mockReset().mockResolvedValue([ENTREE])
})
afterEach(cleanup)

async function rendre(filtres: Record<string, string> = {}) {
  render(await SupervisionPage({ searchParams: Promise.resolve(filtres) }))
}

describe('écran de supervision', () => {
  it('lit les agrégats pour l utilisateur de la session, et les transmet', async () => {
    await rendre()

    expect(listAlertes).toHaveBeenCalledWith('u1')
    expect(readOrdonnanceur).toHaveBeenCalledWith('u1')
    // Câblé sur des tableaux vides, l'écran dirait « rien ne cloche » pendant
    // qu'une alerte attend en base.
    expect(recu.alertes).toMatchObject({ alertes: [ALERTE] })
    expect(recu.travaux).toMatchObject({ travaux: [TRAVAIL], ordonnanceur: ORDONNANCEUR })
  })

  it('affiche l historique du journal, entrée par entrée', async () => {
    await rendre()

    expect(listAuditEvents).toHaveBeenCalledWith('u1', expect.objectContaining({ limit: 100 }))
    expect(screen.getByText('412')).toBeTruthy()
    // Par la cellule, et non par le texte : `cra.valide` figure aussi parmi
    // les choix du filtre, où il ne prouve rien.
    expect(screen.getByRole('cell', { name: 'cra.valide' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'Keveen' })).toBeTruthy()
    expect(screen.getByText(/2026-07/)).toBeTruthy()
  })

  it('FILTRE LE JOURNAL par événement et par dates', async () => {
    await rendre({ action: 'cra.valide', du: '2026-08-01', au: '2026-08-31' })

    expect(listAuditEvents).toHaveBeenCalledWith('u1', {
      action: 'cra.valide',
      du: '2026-08-01',
      au: '2026-08-31',
      limit: 100,
    })
  })

  it('écarte un nom d événement forgé plutôt que de le passer au service', async () => {
    await rendre({ action: 'cra.efface' })

    expect(listAuditEvents).toHaveBeenCalledWith('u1', { limit: 100 })
  })

  it('dit qu il n y a rien plutôt que d afficher un tableau vide', async () => {
    listAuditEvents.mockResolvedValue([])
    await rendre()

    expect(screen.getByText(/aucune entrée/i)).toBeTruthy()
  })

  it('porte le message de retour avec SA tonalité', async () => {
    await rendre({ message: 'Le travail a échoué.', tone: 'danger' })

    const bandeau = screen.getByRole('alert')
    expect(bandeau.textContent).toContain('Le travail a échoué.')
    expect(bandeau.querySelector('svg[data-icone="danger"]')).not.toBeNull()
  })

  it('NE FAIT JAMAIS PASSER UN RETOUR POUR UNE RÉUSSITE en l absence de tonalité', async () => {
    for (const tone of [undefined, 'vert', 'SUCCESS']) {
      cleanup()
      await rendre({ message: 'Retour sans tonalité.', ...(tone === undefined ? {} : { tone }) })
      // `warning` porte le rôle d'alerte et le triangle, jamais la coche.
      const bandeau = screen.getByRole('alert')
      expect(bandeau.querySelector('svg[data-icone="avertissement"]'), String(tone)).not.toBeNull()
      expect(bandeau.querySelector('svg[data-icone="succes"]'), String(tone)).toBeNull()
    }
  })

  it('mène à l écran de synchronisation plutôt que de le redoubler', async () => {
    await rendre()

    const lien = screen.getByRole('link', { name: /synchronisation/i })
    expect(lien.getAttribute('href')).toBe('/admin/sync')
  })
})
