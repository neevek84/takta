// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { OpenConflict } from '@/services/sync/conflicts'
import type { FailedSyncRow } from '@/services/sync/queue'

const { arbitrer, synchroniserMaintenant, rejouer, renvoyerAgenda } = vi.hoisted(() => ({
  arbitrer: vi.fn(),
  synchroniserMaintenant: vi.fn(),
  rejouer: vi.fn(),
  renvoyerAgenda: vi.fn(),
}))
vi.mock('./actions', () => ({ arbitrer, synchroniserMaintenant, rejouer, renvoyerAgenda }))

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
  entityType: 'TimeEntry',
  provider: 'GOOGLE',
  operation: 'UPSERT',
  attempts: 5,
  lastError: 'Agenda injoignable : fetch failed',
  libelle: '2026-03-13 · ACME · ITSM · Consultant',
}

function renderSync(
  overrides: Partial<React.ComponentProps<typeof SyncClient>> = {},
): ReturnType<typeof render> {
  return render(
    <SyncClient conflicts={[]} failures={[]} pending={[]} {...overrides} />,
  )
}

beforeEach(() => {
  arbitrer.mockReset()
  synchroniserMaintenant.mockReset()
  rejouer.mockReset()
})
afterEach(cleanup)

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

  // « Aucun agenda joignable » ne suffit plus : le bouton draine aussi
  // Dolibarr, et ce message-là est le seul que voie une installation sans
  // aucun connecteur.
  it('le dit quand aucun connecteur n est joignable', async () => {
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
        'Aucun connecteur joignable. La saisie et la validation continuent de fonctionner normalement.',
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
 * **Cet écran disait l'inverse, et il avait raison de le dire.** Tant qu'aucun
 * ordonnanceur n'existait, annoncer un drainage périodique aurait fait croire
 * que l'agenda partait tout seul alors que le bouton était le seul écoulement.
 *
 * L'horloge interne existe depuis : c'est le silence qui mentirait maintenant.
 * Ce qui reste vrai, et qu'il faut dire, c'est que l'écoulement dépend d'un
 * travail qu'on peut avoir coupé — sans quoi une file qui ne bouge pas reste
 * inexplicable.
 */
describe('ce que l écran promet du drainage', () => {
  it('annonce l écoulement automatique et sa cadence', () => {
    renderSync()
    expect(screen.getByText(/toutes les/i).textContent).toMatch(/cinq minutes/i)
  })

  it('nomme le travail dont il dépend, et où le régler', () => {
    renderSync()
    const texte = document.body.textContent ?? ''
    expect(texte).toContain('Vidage de la file de sortie')
    expect(texte).toMatch(/supervision/i)
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

describe('la file en attente', () => {
  const enAttente = {
    id: 'row-9',
    entityId: 'cra-1',
    entityType: 'Cra',
    provider: 'DOLIBARR',
    operation: 'UPSERT' as const,
    proprietaire: 'Keveen',
    attenteHeures: 30,
    attempts: 0,
    libelle: 'Cra · cra-1',
  }

  it('montre ce qui attend, et depuis combien de temps', () => {
    // Une file qui ne s'écoule pas ne produit **aucun** échec : elle reste
    // pleine, en silence. C'est dans cet angle mort qu'un CRA validé peut
    // attendre des semaines.
    renderSync({ pending: [enAttente] })
    const texte = document.body.textContent ?? ''

    expect(texte).toContain('Cra · cra-1')
    expect(texte).toContain('en attente depuis 30 h')
    expect(texte).toContain('Rien ne s’écoule tout seul')
  })

  it('le dit quand la file est vide, au lieu de ne rien montrer', () => {
    renderSync({ pending: [] })
    expect(document.body.textContent ?? '').toContain('La file est vide')
  })

  it('force une ligne à repartir', async () => {
    rejouer.mockResolvedValue(true)
    renderSync({ pending: [enAttente] })

    fireEvent.click(screen.getByRole('button', { name: 'Forcer maintenant' }))

    await waitFor(() => expect(rejouer).toHaveBeenCalledWith('row-9'))
  })
})

/**
 * **Le rattrapage vers l'agenda.**
 *
 * Deux chemins ont écrit des saisies sans jamais les mettre en file : la
 * reprise Dolibarr, et toute saisie antérieure à la connexion de l'agenda. Le
 * porteur ne voyait donc que ses prévisionnels tapés à la main, et en a conclu
 * qu'un filtre écartait le réalisé — il n'y en avait aucun.
 */
describe("renvoyer des saisies vers l'agenda", () => {
  it('met en file la période demandée et rend compte', async () => {
    renvoyerAgenda.mockResolvedValue({ ok: true, misesEnFile: 42, motif: '' })
    renderSync()

    fireEvent.change(screen.getByLabelText('Du'), { target: { value: '2026-07-01' } })
    fireEvent.change(screen.getByLabelText('Au'), { target: { value: '2026-07-31' } })
    fireEvent.click(screen.getByRole('button', { name: /Renvoyer/ }))

    await waitFor(() => expect(renvoyerAgenda).toHaveBeenCalledWith('2026-07-01', '2026-07-31'))
    // Le nombre est **dit** : « c'est fait » ne distingue pas un rattrapage de
    // quatre cents blocs d'une période où il n'y avait rien.
    await waitFor(() => expect(document.body.textContent).toContain('42'))
  })

  it('affiche le refus tel que le service le formule', async () => {
    renvoyerAgenda.mockResolvedValue({
      ok: false,
      misesEnFile: 0,
      motif: 'La date de fin précède la date de début.',
    })
    renderSync()

    fireEvent.click(screen.getByRole('button', { name: /Renvoyer/ }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('précède'),
    )
  })

  // L'écran annonçait « aucun drainage automatique n'est installé ». C'était
  // vrai jusqu'à l'horloge interne ; le laisser ferait chercher un cron que
  // personne n'a plus à poser.
  it('ne prétend plus qu aucun drainage automatique n existe', () => {
    renderSync()

    const texte = document.body.textContent ?? ''
    expect(texte).not.toMatch(/aucun drainage automatique/i)
    expect(texte).toMatch(/cinq minutes/i)
  })
})
