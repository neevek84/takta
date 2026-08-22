// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { demanderLien, poserMotDePasse } = vi.hoisted(() => ({
  demanderLien: vi.fn(),
  poserMotDePasse: vi.fn(),
}))
vi.mock('./actions', () => ({ demanderLien, poserMotDePasse }))

import { FormulaireMotDePasse } from './FormulaireMotDePasse'

beforeEach(() => {
  demanderLien.mockReset().mockResolvedValue({ ok: true, message: 'Un lien vient de partir.' })
  poserMotDePasse.mockReset().mockResolvedValue({ ok: true, message: 'Mot de passe enregistré.' })
})
afterEach(cleanup)

function soumettre() {
  fireEvent.submit(document.querySelector('form')!)
}

describe('FormulaireMotDePasse', () => {
  it('demande une adresse quand il n y a pas de jeton', () => {
    render(<FormulaireMotDePasse jeton="" />)
    expect(screen.getByLabelText('Adresse e-mail')).toBeTruthy()
    expect(screen.queryByLabelText('Nouveau mot de passe')).toBeNull()
  })

  // Le jeton voyage dans un champ caché : le remettre à l'écran le ferait
  // apparaître dans une capture ou une copie d'URL partagée.
  it('demande un mot de passe quand un jeton est présent, sans le montrer', () => {
    render(<FormulaireMotDePasse jeton="abc123" />)
    expect(screen.getByLabelText('Nouveau mot de passe')).toBeTruthy()
    expect(screen.queryByText('abc123')).toBeNull()
    const cache = document.querySelector('input[name="jeton"]') as HTMLInputElement
    expect(cache.type).toBe('hidden')
    expect(cache.value).toBe('abc123')
  })

  it('parle de définir autant que de réinitialiser', () => {
    render(<FormulaireMotDePasse jeton="" />)
    expect(document.body.textContent).toMatch(/définir/i)
  })

  /**
   * **Le jeton décide de l'action, pas seulement des champs.** Les deux moments
   * partagent un formulaire ; les inverser rendrait l'écran juste à l'œil et
   * faux au clic — l'adresse partirait au service qui attend un jeton.
   */
  it('sans jeton, la soumission demande un lien', async () => {
    render(<FormulaireMotDePasse jeton="" />)
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), {
      target: { value: 'ada@exemple.test' },
    })
    soumettre()

    await waitFor(() => expect(demanderLien).toHaveBeenCalled())
    expect(poserMotDePasse).not.toHaveBeenCalled()
    const donnees = demanderLien.mock.calls[0]![1] as FormData
    expect(donnees.get('email')).toBe('ada@exemple.test')
  })

  it('avec un jeton, la soumission pose le mot de passe et transmet le jeton', async () => {
    render(<FormulaireMotDePasse jeton="abc123" />)
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), {
      target: { value: 'un-mot-de-passe-solide' },
    })
    soumettre()

    await waitFor(() => expect(poserMotDePasse).toHaveBeenCalled())
    expect(demanderLien).not.toHaveBeenCalled()
    const donnees = poserMotDePasse.mock.calls[0]![1] as FormData
    expect(donnees.get('jeton')).toBe('abc123')
    expect(donnees.get('motDePasse')).toBe('un-mot-de-passe-solide')
  })

  // Le service refuse déjà en deçà de douze caractères, mais il ne le dit
  // qu'après l'aller-retour — et le porteur d'un lien de dix minutes n'a pas
  // de temps à perdre en essais.
  it('exige douze caractères, dès le navigateur', () => {
    render(<FormulaireMotDePasse jeton="abc123" />)
    const champ = screen.getByLabelText('Nouveau mot de passe')
    expect(champ.getAttribute('minlength')).toBe('12')
    expect(champ.getAttribute('type')).toBe('password')
  })

  it('affiche le refus du service au lieu de laisser croire au succès', async () => {
    poserMotDePasse.mockResolvedValue({
      ok: false,
      message: 'Ce lien n’est plus valable. Demandez-en un nouveau.',
    })
    render(<FormulaireMotDePasse jeton="perime" />)
    soumettre()

    const bandeau = await screen.findByRole('alert')
    expect(bandeau.textContent).toContain('n’est plus valable')
  })
})
