// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { DeliveryView } from '@/services/webhooks/delivery'
import type { WebhookView } from '@/services/webhooks/subscriptions'

const { requireUser, listWebhooks, readSeuilSuspension, listDeliveries } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listWebhooks: vi.fn(),
  readSeuilSuspension: vi.fn(),
  listDeliveries: vi.fn(),
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
vi.mock('@/services/webhooks/subscriptions', () => ({ listWebhooks, readSeuilSuspension }))
vi.mock('@/services/webhooks/delivery', () => ({ listDeliveries }))

import WebhooksPage from './page'

const ACTIF: WebhookView = {
  id: 'w1',
  label: 'n8n',
  url: 'https://n8n.test/webhook/cra',
  events: ['cra.valide'],
  state: 'ACTIF',
  lastSeq: 4100,
  consecutiveFailures: 2,
  lastError: 'Réponse 500',
  suspendedAt: null,
}

const SUSPENDU: WebhookView = {
  ...ACTIF,
  id: 'w2',
  label: 'zapier',
  state: 'SUSPENDU',
  lastSeq: 4217,
  consecutiveFailures: 10,
  lastError: 'ECONNREFUSED',
  suspendedAt: new Date('2026-08-12T08:00:00.000Z'),
}

const LIVRAISON: DeliveryView = {
  id: 'd1',
  webhookId: 'w1',
  webhookLabel: 'n8n',
  seq: 4101,
  action: 'cra.valide',
  state: 'ABANDONNE',
  attempts: 5,
  responseStatus: 500,
  durationMs: 120,
  lastError: 'Réponse 500',
  createdAt: new Date('2026-08-15T09:00:00.000Z'),
  deliveredAt: null,
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  listWebhooks.mockReset().mockResolvedValue([ACTIF, SUSPENDU])
  readSeuilSuspension.mockReset().mockResolvedValue(10)
  listDeliveries.mockReset().mockResolvedValue([LIVRAISON])
})
afterEach(cleanup)

async function rendre(filtres: Record<string, string> = {}) {
  render(await WebhooksPage({ searchParams: Promise.resolve(filtres) }))
}

describe('écran des abonnements sortants', () => {
  it('lit les abonnements et les livraisons de la session', async () => {
    await rendre()

    expect(listWebhooks).toHaveBeenCalledWith('u1')
    expect(listDeliveries).toHaveBeenCalledWith('u1', 50)
    // `n8n` figure aussi dans la table des livraisons : c'est l'URL et le
    // second abonnement qui prouvent que la liste vient bien du service.
    expect(screen.getByText('zapier')).toBeTruthy()
    expect(screen.getAllByText('https://n8n.test/webhook/cra')).toHaveLength(2)
  })

  it('distingue actif et suspendu autrement que par la couleur', async () => {
    await rendre()

    const actif = screen.getByText('Actif')
    const suspendu = screen.getByText('Suspendu')
    expect(actif.querySelector('svg[data-icone="succes"]')).not.toBeNull()
    expect(suspendu.querySelector('svg[data-icone="danger"]')).not.toBeNull()
  })

  it('AFFICHE LE SEQ SANS LEQUEL LE RATTRAPAGE EST IMPOSSIBLE', async () => {
    // Réactiver repart de l'instant présent : ce numéro-là est le seul moyen
    // de relire ce qui n'a pas été poussé pendant la suspension.
    await rendre()

    expect(screen.getByText(/since=4217/)).toBeTruthy()
  })

  it('DIT QUE LE COMPTEUR D ÉCHECS EST COMMUN À TOUS LES ÉVÉNEMENTS', async () => {
    // Deux événements malheureux font monter le même compteur : un abonnement
    // par ailleurs sain peut être suspendu par deux URL de test malchanceuses.
    await rendre()

    expect(screen.getByText(/2 échec\(s\) consécutif\(s\) sur 10/)).toBeTruthy()
    expect(screen.getAllByText(/tous événements confondus/i).length).toBeGreaterThan(0)
  })

  it('liste les livraisons, leur état et de quoi les renvoyer', async () => {
    await rendre()

    expect(screen.getByText('4101')).toBeTruthy()
    expect(screen.getByText(/abandonnée/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /renvoyer/i })).toBeTruthy()
  })

  it('dit qu il n y a rien plutôt que d afficher des tableaux vides', async () => {
    listWebhooks.mockResolvedValue([])
    listDeliveries.mockResolvedValue([])
    await rendre()

    expect(screen.getByText(/aucun abonnement/i)).toBeTruthy()
    expect(screen.getByText(/aucune livraison/i)).toBeTruthy()
  })

  it('porte le message de retour avec SA tonalité', async () => {
    await rendre({ message: "L’URL n’a pas répondu.", tone: 'danger' })

    const bandeau = screen.getByRole('alert')
    expect(bandeau.textContent).toContain('L’URL n’a pas répondu.')
    expect(bandeau.querySelector('svg[data-icone="danger"]')).not.toBeNull()
  })

  it('NE FAIT JAMAIS PASSER UN RETOUR POUR UNE RÉUSSITE en l absence de tonalité', async () => {
    for (const tone of [undefined, 'vert', 'SUCCESS']) {
      cleanup()
      await rendre({ message: 'Retour sans tonalité.', ...(tone === undefined ? {} : { tone }) })
      const bandeau = screen.getByRole('alert')
      expect(bandeau.querySelector('svg[data-icone="avertissement"]'), String(tone)).not.toBeNull()
      expect(bandeau.querySelector('svg[data-icone="succes"]'), String(tone)).toBeNull()
    }
  })
})
