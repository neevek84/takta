// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ClientGoogleState } from './actions'

const { useActionState } = vi.hoisted(() => ({ useActionState: vi.fn() }))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useActionState,
}))
vi.mock('./actions', () => ({
  enregistrerClientGoogle: vi.fn(),
  oublierClientGoogle: vi.fn(),
}))

import { ClientOAuthForm } from './ClientOAuthForm'

const SECRET = 'GOCSPX-le-secret-du-client'

function poser(state: ClientGoogleState = null, enCours = false): void {
  useActionState.mockReturnValue([state, vi.fn(), enCours])
}

beforeEach(() => {
  useActionState.mockReset()
  poser()
})

afterEach(cleanup)

function rendre(props: Partial<Parameters<typeof ClientOAuthForm>[0]> = {}) {
  render(
    <ClientOAuthForm
      clientId="1234.apps.googleusercontent.com"
      redirectUri="http://localhost:3000/api/google/callback"
      urlRetourProposee="http://localhost:3000/api/google/callback"
      configure
      configuredAt={new Date('2026-04-02T08:00:00.000Z')}
      {...props}
    />,
  )
}

describe('le secret ne revient jamais à l écran', () => {
  it('laisse le champ du secret vide, même quand un client est enregistré', async () => {
    rendre()

    const champ = screen.getByLabelText(/secret du client/i) as HTMLInputElement
    expect(champ.value).toBe('')
    expect(champ.type).toBe('password')
  })

  it('ne recopie nulle part la valeur du secret dans le document', () => {
    rendre()
    expect(document.body.innerHTML).not.toContain(SECRET)
    expect(document.body.innerHTML).not.toContain('GOCSPX')
  })

  it('réaffiche en revanche l identifiant du client, qui n est pas un secret', () => {
    rendre()
    expect((screen.getByLabelText(/identifiant du client/i) as HTMLInputElement).value).toBe(
      '1234.apps.googleusercontent.com',
    )
  })
})

describe("l'URL de retour proposée", () => {
  it('préremplit le champ quand rien n est encore enregistré', () => {
    // On ne demande à personne de la deviner : elle correspond à l'adresse
    // réellement servie.
    rendre({
      clientId: '',
      redirectUri: '',
      urlRetourProposee: 'http://localhost:3001/api/google/callback',
      configure: false,
      configuredAt: null,
    })

    expect((screen.getByLabelText(/URL de retour/i) as HTMLInputElement).value).toBe(
      'http://localhost:3001/api/google/callback',
    )
  })

  it('n écrase pas une URL déjà enregistrée par la proposition', () => {
    // Sinon, ouvrir cet écran depuis une autre adresse réécrirait en silence
    // une URL que Google a déjà acceptée.
    rendre({
      redirectUri: 'https://cra.exemple.fr/api/google/callback',
      urlRetourProposee: 'http://localhost:3000/api/google/callback',
    })

    expect((screen.getByLabelText(/URL de retour/i) as HTMLInputElement).value).toBe(
      'https://cra.exemple.fr/api/google/callback',
    )
  })
})

describe('les retours du formulaire', () => {
  it('annonce un enregistrement réussi', () => {
    poser({ ok: true, message: 'Client OAuth Google enregistré.' })
    rendre()

    expect(screen.getByRole('status').textContent).toContain('enregistré')
  })

  it('annonce un refus comme un refus, pas comme un succès', () => {
    // Le défaut de l'écran voisin, à ne pas reproduire : tout retour affiché
    // en vert avec une coche, refus compris.
    poser({ ok: false, erreurs: ["L'identifiant du client OAuth est requis."] })
    rendre()

    const bandeau = screen.getByRole('alert')
    expect(bandeau.querySelector('svg[data-icone="danger"]')).not.toBeNull()
    expect(bandeau.textContent).toContain("L'identifiant du client OAuth est requis.")
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('liste tous les refus, pas seulement le premier', () => {
    poser({ ok: false, erreurs: ['Un.', 'Deux.', 'Trois.'] })
    rendre()

    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})

describe("l'état de la configuration se lit en toutes lettres", () => {
  it('dit que l application fonctionne sans Google quand rien n est configuré', () => {
    rendre({ clientId: '', redirectUri: '', configure: false, configuredAt: null })

    expect(document.body.textContent).toContain('sans Google')
    // Rien à oublier tant que rien n'est enregistré.
    expect(screen.queryByRole('button', { name: /oublier/i })).toBeNull()
  })

  it('propose d oublier le client quand il en existe un', () => {
    rendre()
    expect(screen.getByRole('button', { name: /oublier/i })).toBeTruthy()
  })

  it('dit depuis quand le client est enregistré', () => {
    rendre()
    expect(document.body.textContent).toContain('2026-04-02')
  })
})

describe('le renvoi vers la connexion', () => {
  // Le porteur a cherché sur cet écran un bouton qui n'y est pas : celui-ci
  // enregistre le client OAuth de l'instance, la connexion d'un compte se fait
  // dans Synchro. La séparation a sa raison ; l'absence de panneau, non.
  it('dit où connecter un compte, une fois le client enregistré', () => {
    rendre({ clientId: '123.apps.googleusercontent.com', configure: true })

    const lien = screen.getByRole('link', { name: /Synchro/ })
    expect(lien.getAttribute('href')).toBe('/admin/sync')
  })

  // Sans client, il n'y a rien à connecter : renvoyer vers Synchro ferait
  // tourner en rond.
  it('ne renvoie nulle part tant qu aucun client n est enregistré', () => {
    rendre({ configure: false })

    expect(screen.queryByRole('link', { name: /Synchro/ })).toBeNull()
  })
})

