// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { connecterDolibarr, deconnecterDolibarr } = vi.hoisted(() => ({
  connecterDolibarr: vi.fn(),
  deconnecterDolibarr: vi.fn(),
}))
vi.mock('./actions', () => ({ connecterDolibarr, deconnecterDolibarr }))

import { ConnexionForm } from './ConnexionForm'

const INSTANCE_FICTIVE = 'https://erp.invalid'

beforeEach(() => {
  connecterDolibarr.mockReset().mockResolvedValue({ ok: true, message: 'Connexion enregistrée.' })
  deconnecterDolibarr.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

function rendre(patch: Partial<Parameters<typeof ConnexionForm>[0]> = {}) {
  render(
    <ConnexionForm
      instanceUrl={INSTANCE_FICTIVE}
      connecte={true}
      connectedAt={new Date('2026-08-15T08:00:00.000Z')}
      {...patch}
    />,
  )
}

function formulaireDeConnexion(): HTMLFormElement {
  const champ = screen.getByLabelText("Clé d'API")
  const form = champ.closest('form')
  if (!form) throw new Error('formulaire de connexion introuvable')
  return form
}

describe('ConnexionForm', () => {
  it('ne réaffiche jamais la clé enregistrée', () => {
    // Le composant ne reçoit aucun secret, et le champ repart vide et masqué :
    // une clé relue à l'écran est une clé à changer.
    rendre()
    const cle = screen.getByLabelText("Clé d'API") as HTMLInputElement

    expect(cle.value).toBe('')
    expect(cle.getAttribute('type')).toBe('password')
    expect(document.body.textContent ?? '').not.toContain('DOLAPIKEY')
  })

  it('rappelle l URL déjà connue', () => {
    // Sans elle, corriger une URL obligerait à la retaper de mémoire.
    rendre()
    // Ce que le champ réaffiche est ce qu'il accepte : l'adresse de l'instance,
    // jamais la base d'API que l'application en dérive.
    expect(
      (screen.getByLabelText("URL de l'instance Dolibarr") as HTMLInputElement).value,
    ).toBe(INSTANCE_FICTIVE)
  })

  it('envoie l’URL et la clé, et rien d’autre', async () => {
    rendre({ instanceUrl: '', connecte: false, connectedAt: null })

    await userEvent.type(screen.getByLabelText("URL de l'instance Dolibarr"), INSTANCE_FICTIVE)
    await userEvent.type(screen.getByLabelText("Clé d'API"), 'cle-de-test')
    await userEvent.click(screen.getByRole('button', { name: 'Connecter' }))

    await waitFor(() => expect(connecterDolibarr).toHaveBeenCalled())
    const fd = connecterDolibarr.mock.calls[0]![1] as FormData
    expect({ instanceUrl: fd.get('instanceUrl'), apiKey: fd.get('apiKey') }).toEqual({
      instanceUrl: INSTANCE_FICTIVE,
      apiKey: 'cle-de-test',
    })
    expect(fd.get('dolibarrUserId')).toBeNull()
  })

  // Deux lieux pour un même réglage, et c'est le second qui gagne en silence :
  // l'identifiant est personnel depuis que le push lit celui du propriétaire du
  // CRA. Le laisser ici le ferait ressaisir pour tout le monde.
  it('ne demande plus l’identifiant utilisateur, qui est personnel', () => {
    rendre({ instanceUrl: '', connecte: true, connectedAt: null })

    expect(screen.queryByLabelText('Identifiant utilisateur Dolibarr')).toBeNull()
    expect(document.body.textContent).toMatch(/Mon profil/)
  })

  it('annonce les refus rendus par l action', async () => {
    connecterDolibarr.mockResolvedValue({
      ok: false,
      erreurs: ["La clé d'API est requise.", "L'adresse de l'instance Dolibarr est requise."],
    })
    rendre()

    fireEvent.submit(formulaireDeConnexion())

    // `alert` et non `status` : un refus interrompt, il ne patiente pas.
    const alerte = await screen.findByRole('alert')
    expect(alerte.textContent).toContain("La clé d'API est requise.")
    expect(alerte.textContent).toContain("L'adresse de l'instance Dolibarr est requise.")
  })

  it('confirme l enregistrement', async () => {
    rendre()
    fireEvent.submit(formulaireDeConnexion())

    const statut = await screen.findByRole('status')
    expect(statut.textContent).toContain('Connexion enregistrée.')
  })

  it('ne propose la déconnexion que lorsque Dolibarr est connecté', () => {
    rendre({ connecte: false, connectedAt: null })
    expect(screen.queryByRole('button', { name: 'Déconnecter' })).toBeNull()

    cleanup()
    rendre({ connecte: true })
    expect(screen.getByRole('button', { name: 'Déconnecter' })).toBeTruthy()
  })

  it('dit que l application fonctionne sans Dolibarr', () => {
    // Le porteur a été explicite : Dolibarr est un complément, pas une
    // obligation. L'écran doit le dire, sinon un connecteur éteint se lit
    // comme une application cassée.
    rendre({ connecte: false, connectedAt: null })
    expect(document.body.textContent ?? '').toContain(
      'Tout reste créable et modifiable sans lui.',
    )
  })
})
