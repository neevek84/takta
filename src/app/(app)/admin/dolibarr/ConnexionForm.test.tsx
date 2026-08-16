// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { connecterDolibarr, deconnecterDolibarr } = vi.hoisted(() => ({
  connecterDolibarr: vi.fn(),
  deconnecterDolibarr: vi.fn(),
}))
vi.mock('./actions', () => ({ connecterDolibarr, deconnecterDolibarr }))

import { ConnexionForm } from './ConnexionForm'

const URL_FICTIVE = 'https://erp.invalid/api/index.php'

beforeEach(() => {
  connecterDolibarr.mockReset().mockResolvedValue({ ok: true, message: 'Connexion enregistrée.' })
  deconnecterDolibarr.mockReset().mockResolvedValue(undefined)
})
afterEach(cleanup)

function rendre(patch: Partial<Parameters<typeof ConnexionForm>[0]> = {}) {
  render(
    <ConnexionForm
      baseUrl={URL_FICTIVE}
      dolibarrUserId="3"
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

  it('rappelle l URL et l identifiant utilisateur déjà connus', () => {
    // Sans eux, corriger une URL obligerait à la retaper de mémoire.
    rendre()
    expect((screen.getByLabelText("URL de l'API") as HTMLInputElement).value).toBe(URL_FICTIVE)
    expect(
      (screen.getByLabelText('Identifiant utilisateur Dolibarr') as HTMLInputElement).value,
    ).toBe('3')
  })

  it('transmet les trois champs sous les noms que l action relit', async () => {
    // Cette couture est invisible : renommer un champ d'un seul côté fait
    // échouer la connexion sans qu'aucune erreur ne l'explique.
    rendre({ baseUrl: '', dolibarrUserId: '', connecte: false, connectedAt: null })

    fireEvent.change(screen.getByLabelText("URL de l'API"), { target: { value: URL_FICTIVE } })
    fireEvent.change(screen.getByLabelText("Clé d'API"), { target: { value: 'cle-de-test' } })
    fireEvent.change(screen.getByLabelText('Identifiant utilisateur Dolibarr'), {
      target: { value: '7' },
    })
    fireEvent.submit(formulaireDeConnexion())

    await waitFor(() => expect(connecterDolibarr).toHaveBeenCalled())
    const fd = connecterDolibarr.mock.calls[0]![1] as FormData
    expect({
      baseUrl: fd.get('baseUrl'),
      apiKey: fd.get('apiKey'),
      dolibarrUserId: fd.get('dolibarrUserId'),
    }).toEqual({ baseUrl: URL_FICTIVE, apiKey: 'cle-de-test', dolibarrUserId: '7' })
  })

  it('annonce les refus rendus par l action', async () => {
    connecterDolibarr.mockResolvedValue({
      ok: false,
      erreurs: ["La clé d'API est requise.", "L'URL de l'API Dolibarr est requise."],
    })
    rendre()

    fireEvent.submit(formulaireDeConnexion())

    // `alert` et non `status` : un refus interrompt, il ne patiente pas.
    const alerte = await screen.findByRole('alert')
    expect(alerte.textContent).toContain("La clé d'API est requise.")
    expect(alerte.textContent).toContain("L'URL de l'API Dolibarr est requise.")
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
