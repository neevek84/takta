// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { requireUser, getGoogleOAuthClientView, headers } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getGoogleOAuthClientView: vi.fn(),
  headers: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/headers', () => ({ headers }))
vi.mock('@/services/google/oauth-client', () => ({ getGoogleOAuthClientView }))

// Le formulaire est remplacé par un témoin : ce test porte sur le **câblage**
// de la page, pas sur le rendu du formulaire, qui a ses propres tests.
const recu = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }))
vi.mock('./ClientOAuthForm', () => ({
  ClientOAuthForm: (props: Record<string, unknown>) => {
    recu.props = props
    return <div data-testid="formulaire" />
  },
}))

import AdminGooglePage from './page'

const CLIENT = {
  clientId: '1234.apps.googleusercontent.com',
  redirectUri: 'http://localhost:3000/api/google/callback',
  configuredAt: new Date('2026-04-02T08:00:00.000Z'),
}

/** Un jeu d'en-têtes minimal, tel que Next le rend. */
function entetes(valeurs: Record<string, string>) {
  return { get: (nom: string) => valeurs[nom.toLowerCase()] ?? null }
}

beforeEach(() => {
  recu.props = null
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  getGoogleOAuthClientView.mockReset().mockResolvedValue(CLIENT)
  headers.mockReset().mockResolvedValue(entetes({ host: 'localhost:3000' }))
})

afterEach(cleanup)

async function rendre(params: Record<string, string> = {}) {
  render(await AdminGooglePage({ searchParams: Promise.resolve(params) }))
}

describe("l'écran affiche l'URL de retour à enregistrer", () => {
  it('la calcule depuis l adresse réellement servie', async () => {
    await rendre()
    expect(screen.getByText('http://localhost:3000/api/google/callback')).toBeTruthy()
  })

  it('produit une URL différente sur un autre port, et l affiche', async () => {
    // C'est exactement ce que fait le démarrage portable quand le 3000 est
    // pris. Une URL figée à 3000 laisserait la personne enregistrer une URL
    // que Google refusera.
    headers.mockResolvedValue(entetes({ host: 'localhost:3001' }))
    await rendre()

    expect(screen.getByText('http://localhost:3001/api/google/callback')).toBeTruthy()
    expect(screen.queryByText('http://localhost:3000/api/google/callback')).toBeNull()
  })

  it('respecte le protocole annoncé par un mandataire', async () => {
    headers.mockResolvedValue(
      entetes({ host: 'interne:3000', 'x-forwarded-host': 'cra.exemple.fr', 'x-forwarded-proto': 'https' }),
    )
    await rendre()

    expect(screen.getByText('https://cra.exemple.fr/api/google/callback')).toBeTruthy()
  })

  it('dit quoi faire quand l adresse servie est indéterminable', async () => {
    headers.mockResolvedValue(entetes({}))
    await rendre()

    expect(screen.getByRole('alert').textContent).toContain('/api/google/callback')
  })

  it('explique ce qu un changement de port casse', async () => {
    await rendre()
    const texte = document.body.textContent ?? ''

    expect(texte).toContain('port')
    expect(texte).toContain('CRA_PORT')
    // La cause doit être nommée : sans cela, l'échec vient de Google et
    // personne ne fait le lien avec le port.
    expect(texte).toContain('Google')
  })

  it('dit ce qui reste à faire chez Google, que rien ne peut automatiser', async () => {
    await rendre()
    const texte = document.body.textContent ?? ''

    expect(texte).toContain('https://www.googleapis.com/auth/calendar')
    expect(texte).toContain('Google Cloud')
  })
})

describe('le câblage de la page', () => {
  it('transmet la vue du client au formulaire, sans aucun secret', async () => {
    await rendre()

    expect(recu.props?.clientId).toBe(CLIENT.clientId)
    expect(recu.props?.redirectUri).toBe(CLIENT.redirectUri)
    expect(recu.props?.configure).toBe(true)
    expect(Object.keys(recu.props ?? {})).not.toContain('clientSecret')
  })

  it('propose l URL calculée au formulaire quand rien n est enregistré', async () => {
    getGoogleOAuthClientView.mockResolvedValue(null)
    await rendre()

    expect(recu.props?.configure).toBe(false)
    expect(recu.props?.urlRetourProposee).toBe('http://localhost:3000/api/google/callback')
  })

  it('reste utilisable sans aucun connecteur configuré', async () => {
    // L'autoportance : sans client OAuth, l'écran s'affiche et explique.
    getGoogleOAuthClientView.mockResolvedValue(null)
    await rendre()

    expect(screen.getByTestId('formulaire')).toBeTruthy()
  })

  it('exige une session', async () => {
    requireUser.mockRejectedValue(new Error('non authentifié'))
    await expect(rendre()).rejects.toThrow()
  })
})

describe('la tonalité du message de retour', () => {
  it('affiche un succès comme un succès', async () => {
    await rendre({ message: 'Client enregistré.', tone: 'success' })
    expect(screen.getByRole('status').textContent).toContain('Client enregistré.')
  })

  it('n affiche pas un renvoi comme un succès', async () => {
    // Le défaut de l'écran voisin, à ne pas reproduire : tout message rendu
    // à l'identique, refus compris.
    await rendre({ message: "Aucun client OAuth n'est enregistré.", tone: 'warning' })

    const bandeau = screen.getByRole('alert')
    expect(bandeau.querySelector('svg[data-icone="avertissement"]')).not.toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('ne laisse pas une tonalité absente ou forgée passer pour un succès', async () => {
    const cas: Record<string, string>[] = [{ message: 'Sans tonalité.' }, { message: 'X', tone: 'vert' }]
    for (const params of cas) {
      cleanup()
      await rendre(params)
      expect(
        screen.getByRole('alert').querySelector('svg[data-icone="avertissement"]'),
      ).not.toBeNull()
    }
  })
})
