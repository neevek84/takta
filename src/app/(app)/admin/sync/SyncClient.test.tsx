// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { OpenConflict } from '@/services/sync/conflicts'
import type { FailedSyncRow } from '@/services/sync/queue'

const { arbitrer, synchroniserMaintenant, rejouer, revoquerGoogle } = vi.hoisted(() => ({
  arbitrer: vi.fn(),
  synchroniserMaintenant: vi.fn(),
  rejouer: vi.fn(),
  revoquerGoogle: vi.fn(),
}))
vi.mock('./actions', () => ({ arbitrer, synchroniserMaintenant, rejouer, revoquerGoogle }))

import { SyncClient } from './SyncClient'

const conflit: OpenConflict = {
  id: 'c1',
  entityId: 'e1',
  kind: 'REMOTE_MODIFIED',
  detectedAt: new Date('2026-03-20T10:00:00.000Z'),
  libelle: '2026-03-12 · ACME · ITSM · Consultant',
  remote: {
    summary: 'Déplacé à la main',
    startLocal: '2026-03-18T14:00:00',
    endLocal: '2026-03-18T18:00:00',
  },
}

const echec: FailedSyncRow = {
  id: 'r1',
  entityId: 'e2',
  operation: 'UPSERT',
  attempts: 5,
  lastError: 'Agenda injoignable : fetch failed',
  libelle: '2026-03-13 · ACME · ITSM · Consultant',
}

const CONNECTE = {
  connected: true,
  calendarId: 'cra@group.calendar.google.com',
  scope: 'calendar',
  connectedAt: new Date('2026-03-01T09:00:00.000Z'),
}

function renderSync(
  overrides: Partial<React.ComponentProps<typeof SyncClient>> = {},
): ReturnType<typeof render> {
  return render(<SyncClient connection={CONNECTE} conflicts={[]} failures={[]} {...overrides} />)
}

beforeEach(() => {
  arbitrer.mockReset()
  synchroniserMaintenant.mockReset()
  rejouer.mockReset()
  revoquerGoogle.mockReset()
})
afterEach(cleanup)

describe('état de la connexion', () => {
  it('propose de connecter quand aucun compte ne l est', () => {
    renderSync({
      connection: { connected: false, calendarId: '', scope: '', connectedAt: null },
    })
    const lien = screen.getByRole('link', { name: 'Connecter Google Calendar' })
    expect(lien.getAttribute('href')).toBe('/api/google/connect')
    expect(screen.queryByRole('button', { name: 'Révoquer la connexion' })).toBeNull()
  })

  it('affiche le calendrier dédié et propose de révoquer', () => {
    renderSync()
    expect(screen.getByText(/cra@group\.calendar\.google\.com/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Révoquer la connexion' })).toBeTruthy()
  })
})

describe('divergences', () => {
  it('offre les trois issues', () => {
    renderSync({ conflicts: [conflit] })
    expect(screen.getByText(/Déplacé à la main/)).toBeTruthy()
    for (const nom of ['Rétablir', 'Accepter', 'Détacher']) {
      expect(screen.getByRole('button', { name: nom })).toBeTruthy()
    }
  })

  it('affiche le motif quand l arbitrage est refusé', async () => {
    // Si la règle refuse, le conflit reste ouvert et le motif est affiché.
    arbitrer.mockResolvedValue({
      ok: false,
      reason: 'VERROUILLE',
      message: "Le CRA de ce mois est validé : la version de l'agenda ne peut pas être acceptée.",
    })
    renderSync({ conflicts: [conflit] })

    fireEvent.click(screen.getByRole('button', { name: 'Accepter' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('validé')
    })
    expect(arbitrer).toHaveBeenCalledWith('c1', 'ACCEPTER')
  })

  // Le pendant du test ci-dessus : les deux autres issues doivent partir avec
  // leur propre résolution. Trois boutons câblés sur « ACCEPTER » passeraient
  // le test précédent sans que rien ne le dise.
  it('envoie à chaque bouton sa propre issue', async () => {
    arbitrer.mockResolvedValue({ ok: true, resolution: 'RETABLIR' })
    renderSync({ conflicts: [conflit] })

    fireEvent.click(screen.getByRole('button', { name: 'Rétablir' }))
    await waitFor(() => expect(arbitrer).toHaveBeenCalledWith('c1', 'RETABLIR'))

    fireEvent.click(screen.getByRole('button', { name: 'Détacher' }))
    await waitFor(() => expect(arbitrer).toHaveBeenCalledWith('c1', 'DETACHER'))
  })

  it('annonce quand il n y a rien à arbitrer', () => {
    renderSync()
    expect(screen.getByText('Aucune divergence à arbitrer.')).toBeTruthy()
  })
})

describe('échecs', () => {
  it('liste la ligne en échec avec son motif et propose de la rejouer', () => {
    renderSync({ failures: [echec] })
    expect(screen.getByText(/Agenda injoignable/)).toBeTruthy()
    expect(screen.getByText(/5 tentative/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rejouer' })).toBeTruthy()
  })

  // Un bouton qui n'appelle rien laisserait la ligne en échec pour toujours,
  // en donnant à l'écran l'apparence d'un recours.
  it('rejoue la ligne désignée', async () => {
    rejouer.mockResolvedValue(true)
    renderSync({ failures: [echec] })

    fireEvent.click(screen.getByRole('button', { name: 'Rejouer' }))

    await waitFor(() => expect(rejouer).toHaveBeenCalledWith('r1'))
  })
})

describe('synchroniser maintenant', () => {
  it('rend compte de ce qui a été fait', async () => {
    synchroniserMaintenant.mockResolvedValue({
      nonConnecte: false,
      traitees: 3,
      reussies: 2,
      conflits: 1,
      echecs: 0,
      reste: 0,
    })
    renderSync()

    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain(
        '3 élément(s) traité(s) : 2 synchronisé(s), 1 divergence(s), 0 échec(s).',
      )
    })
    expect(synchroniserMaintenant).toHaveBeenCalledTimes(1)
  })

  it('le dit quand aucun compte n est connecté', async () => {
    synchroniserMaintenant.mockResolvedValue({
      nonConnecte: true,
      traitees: 0,
      reussies: 0,
      conflits: 0,
      echecs: 0,
      reste: 0,
    })
    renderSync()

    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain(
        'Aucun agenda joignable. La saisie continue de fonctionner normalement.',
      )
    })
  })

  // Un compte rendu « 50 traité(s), 50 synchronisé(s) » sans mention du reste
  // est indiscernable d'une file vidée : l'utilisateur referme l'écran en
  // croyant son agenda à jour.
  it('annonce ce qui reste à drainer au lieu de laisser croire à une file vidée', async () => {
    synchroniserMaintenant.mockResolvedValue({
      nonConnecte: false,
      traitees: 1000,
      reussies: 1000,
      conflits: 0,
      echecs: 0,
      reste: 16,
    })
    renderSync()

    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }))

    await waitFor(() => {
      const texte = screen.getByRole('alert').textContent ?? ''
      expect(texte).toContain('16')
      expect(texte).toMatch(/reste/i)
    })
  })

  it('ne parle pas de reste quand la file est vidée', async () => {
    synchroniserMaintenant.mockResolvedValue({
      nonConnecte: false,
      traitees: 3,
      reussies: 3,
      conflits: 0,
      echecs: 0,
      reste: 0,
    })
    renderSync()

    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }))

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy())
    expect(screen.getByRole('status').textContent).not.toMatch(/reste/i)
  })
})

/**
 * Aucun ordonnanceur n'existe dans le dépôt : ni `instrumentation.ts`, ni
 * `setInterval`, ni service dans `docker-compose.yml`, ni entrée cron. Annoncer
 * un drainage périodique ferait croire à l'utilisateur que son agenda part tout
 * seul alors que ce bouton est le seul écoulement de l'installation nominale.
 */
describe('ce que l écran promet du drainage', () => {
  it('ne promet aucun drainage automatique', () => {
    renderSync()
    expect(screen.queryByText(/tout seul/i)).toBeNull()
    expect(screen.queryByText(/périodique/i)).toBeNull()
  })

  it('dit comment poser un drainage périodique pour qui en veut un', () => {
    renderSync()
    expect(screen.getByText(/Aucun drainage automatique/i)).toBeTruthy()
    expect(screen.getByText(/\/api\/sync\/flush/)).toBeTruthy()
    expect(screen.getByText(/SYNC_FLUSH_TOKEN/)).toBeTruthy()
  })
})

/**
 * Une action serveur qui lève (panne base, session expirée, contrainte
 * d'unicité) produit sinon un rejet non traité : le bouton se rétablit, rien ne
 * s'affiche, et l'utilisateur conclut que son geste a été pris en compte. C'est
 * le vecteur qui rendrait un arbitrage destructeur parfaitement silencieux.
 */
describe('quand une action serveur échoue', () => {
  it('annonce l échec de l arbitrage au lieu de ne rien dire', async () => {
    arbitrer.mockRejectedValue(new Error('connexion perdue'))
    renderSync({ conflicts: [conflit] })

    fireEvent.click(screen.getByRole('button', { name: 'Accepter' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/échoué|impossible/i)
    })
    // Et surtout : rien n'annonce un succès.
    expect(screen.queryByText('Divergence arbitrée.')).toBeNull()
  })

  it('annonce l échec du rejeu', async () => {
    rejouer.mockRejectedValue(new Error('connexion perdue'))
    renderSync({ failures: [echec] })

    fireEvent.click(screen.getByRole('button', { name: 'Rejouer' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/échoué|impossible/i)
    })
    expect(screen.queryByText('Ligne remise en file.')).toBeNull()
  })

  it('annonce l échec de la synchronisation et rend la main', async () => {
    synchroniserMaintenant.mockRejectedValue(new Error('connexion perdue'))
    renderSync()

    fireEvent.click(screen.getByRole('button', { name: 'Synchroniser maintenant' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/échoué|impossible/i)
    })
    // Le bouton reste utilisable : un échec ne doit pas laisser l'écran inerte.
    const bouton = screen.getByRole('button', { name: 'Synchroniser maintenant' })
    expect(bouton.hasAttribute('disabled')).toBe(false)
  })
})
