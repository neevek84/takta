// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { saveSignataire } = vi.hoisted(() => ({ saveSignataire: vi.fn() }))
vi.mock('./actions', () => ({ saveSignataire }))

// `vi.mock` est hissé au-dessus des imports : le server action n'est jamais
// chargé, seul le composant l'est.
import { SignataireForm } from './SignataireForm'

beforeEach(() => {
  saveSignataire.mockReset().mockResolvedValue({ ok: true })
})

afterEach(cleanup)

function poser(nom = '', email = ''): void {
  render(<SignataireForm missionId="m1" signataireNom={nom} signataireEmail={email} />)
}

// `fireEvent.submit` sur le formulaire, et non un clic sur le bouton : happy-dom
// ne déclenche pas la soumission implicite d un `<button type="submit">`.
function soumettre(): void {
  const form = document.querySelector('form')
  if (form === null) throw new Error('formulaire introuvable')
  fireEvent.submit(form)
}

describe('SignataireForm', () => {
  it('affiche le signataire déjà enregistré', () => {
    poser('Claire Martin', 'claire@acme.test')
    expect(screen.getByLabelText('Signataire du CRA')).toHaveProperty('value', 'Claire Martin')
    expect(screen.getByLabelText('Adresse électronique')).toHaveProperty(
      'value',
      'claire@acme.test',
    )
  })

  it('transporte la mission concernée, sans quoi l écriture viserait une autre', () => {
    const { container } = render(
      <SignataireForm missionId="m-42" signataireNom="" signataireEmail="" />,
    )
    const cache = container.querySelector('input[name="missionId"]')
    expect(cache).not.toBeNull()
    expect(cache).toHaveProperty('value', 'm-42')
  })

  it('annonce le refus du service plutôt que de se recomposer en silence', async () => {
    saveSignataire.mockResolvedValue({
      ok: false,
      erreur: 'L’adresse électronique du signataire est invalide.',
    })
    poser('X', 'pas-une-adresse')

    soumettre()

    // `role="alert"` : le refus interrompt, il ne se contente pas d'attendre
    // qu'on repasse dessus.
    const alerte = await screen.findByRole('alert')
    expect(alerte.textContent).toContain('L’adresse électronique du signataire est invalide.')
  })

  it('confirme l enregistrement quand le service accepte', async () => {
    poser('Claire Martin', 'claire@acme.test')
    soumettre()

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Signataire enregistré.')
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ne confirme rien tant que rien n a été soumis', () => {
    poser('Claire Martin', 'claire@acme.test')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
