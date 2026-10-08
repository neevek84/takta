// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { enregistrerSignature, deconnecterSignature, genererSecret, testerSignature } = vi.hoisted(() => ({
  enregistrerSignature: vi.fn(),
  deconnecterSignature: vi.fn(),
  genererSecret: vi.fn(),
  testerSignature: vi.fn(),
}))
vi.mock('./actions', () => ({ enregistrerSignature, deconnecterSignature, genererSecret, testerSignature }))

import { ConnexionForm } from './ConnexionForm'
import { SecretWebhook } from './SecretWebhook'
import { TestConnexion } from './TestConnexion'

const SECRET = 'a1'.repeat(32)

beforeEach(() => {
  enregistrerSignature.mockReset().mockResolvedValue({ ok: true, message: 'Réglage enregistré.' })
  deconnecterSignature.mockReset().mockResolvedValue(undefined)
  genererSecret.mockReset().mockResolvedValue({ ok: true, secret: SECRET })
  testerSignature.mockReset()
})
afterEach(cleanup)

describe('ConnexionForm (signature)', () => {
  it('envoie l URL et la clé ; la clé repart vide et masquée', async () => {
    render(<ConnexionForm baseUrl="" provenance="aucune" enregistreLe={null} />)
    const cle = screen.getByLabelText("Clé d'API") as HTMLInputElement
    expect(cle.getAttribute('type')).toBe('password')

    await userEvent.type(screen.getByLabelText("URL de l'instance Documenso"), 'https://sign.invalid')
    await userEvent.type(cle, 'cle-de-test')
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(enregistrerSignature).toHaveBeenCalled())
    const fd = enregistrerSignature.mock.calls[0]![1] as FormData
    expect({ baseUrl: fd.get('baseUrl'), apiKey: fd.get('apiKey') }).toEqual({
      baseUrl: 'https://sign.invalid',
      apiKey: 'cle-de-test',
    })
    expect(await screen.findByRole('status')).toBeTruthy()
  })

  it('une clé déjà enregistrée : laisser vide pour la conserver, et Déconnecter', () => {
    render(<ConnexionForm baseUrl="https://sign.invalid" provenance="ecran" enregistreLe={new Date()} />)
    expect(document.body.textContent).toContain('laisser vide pour conserver')
    expect(screen.getByRole('button', { name: 'Déconnecter' })).toBeTruthy()
  })
})

describe('SecretWebhook', () => {
  it('sans secret : génère et affiche le secret une seule fois', async () => {
    render(<SecretWebhook provenance="aucune" genereLe={null} />)
    expect(document.body.textContent).not.toContain(SECRET)

    await userEvent.click(screen.getByRole('button', { name: 'Générer le secret' }))

    await waitFor(() => expect(screen.getByText(SECRET)).toBeTruthy())
    expect(document.body.textContent).toMatch(/une seule fois/)
  })

  it('un secret existant ne se régénère qu après confirmation', async () => {
    render(<SecretWebhook provenance="ecran" genereLe={new Date('2026-10-02T08:00:00Z')} />)

    await userEvent.click(screen.getByRole('button', { name: 'Régénérer le secret' }))
    expect(genererSecret).not.toHaveBeenCalled()
    const dialogue = screen.getByRole('dialog')
    expect(dialogue.textContent).toMatch(/ancien secret/)

    await userEvent.click(screen.getByRole('button', { name: 'Régénérer' }))
    await waitFor(() => expect(genererSecret).toHaveBeenCalled())
    const fd = genererSecret.mock.calls[0]![1] as FormData
    expect(fd.get('confirmer')).toBe('oui')
    await waitFor(() => expect(screen.getByText(SECRET)).toBeTruthy())
  })

  it('annonce un refus', async () => {
    genererSecret.mockResolvedValue({ ok: false, erreur: 'Confirmez la régénération.' })
    render(<SecretWebhook provenance="aucune" genereLe={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Générer le secret' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Confirmez la régénération.')
  })
})

describe('TestConnexion', () => {
  it('dit chaque verdict en toutes lettres', async () => {
    testerSignature.mockResolvedValue({
      ok: false,
      verifications: [
        { cle: 'instance', etat: 'ok', texte: 'L’instance répond.' },
        { cle: 'api-v2', etat: 'echec', texte: 'Documenso 2.0 ou plus est requis.' },
        { cle: 'cle', etat: 'non-verifie', texte: 'La clé n’a pas pu être vérifiée.' },
      ],
    })
    render(<TestConnexion />)
    await userEvent.click(screen.getByRole('button', { name: 'Tester' }))

    const items = await screen.findAllByRole('listitem')
    expect(items.map((li) => li.textContent)).toEqual([
      'Réussi : L’instance répond.',
      'Échec : Documenso 2.0 ou plus est requis.',
      'Non vérifié : La clé n’a pas pu être vérifiée.',
    ])
  })
})
