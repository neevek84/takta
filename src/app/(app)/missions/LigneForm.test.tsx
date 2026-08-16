// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { modifierLigne } = vi.hoisted(() => ({ modifierLigne: vi.fn() }))
vi.mock('./actions', () => ({ modifierLigne }))

// `vi.mock` est hissé au-dessus des imports : le server action n'est jamais
// chargé, seul le composant l'est.
import { LigneForm } from './LigneForm'

beforeEach(() => {
  modifierLigne.mockReset().mockResolvedValue({ ok: true })
})

afterEach(cleanup)

const MANUELLE = {
  id: 'l1',
  label: 'Consultant ITSM',
  soldCentiemes: 3000,
  tjmCents: 80_000,
  displayUnit: 'JOUR' as const,
  engagementSource: 'MANUEL' as const,
}

const REPRISE = { ...MANUELLE, engagementSource: 'DOLIBARR_PROPALE' as const }

function soumettre(): void {
  const form = document.querySelector('form')
  if (form === null) throw new Error('formulaire introuvable')
  fireEvent.submit(form)
}

describe('LigneForm', () => {
  it('affiche les chiffres vendus dans leurs unités lisibles', () => {
    render(<LigneForm line={MANUELLE} />)
    expect(screen.getByLabelText('Jours vendus')).toHaveProperty('value', '30')
    expect(screen.getByLabelText('TJM (€)')).toHaveProperty('value', '800')
  })

  it('transporte la prestation concernée, sans quoi l écriture viserait une autre', () => {
    const { container } = render(<LigneForm line={{ ...MANUELLE, id: 'l-42' }} />)
    expect(container.querySelector('input[name="lineId"]')).toHaveProperty('value', 'l-42')
  })

  it('laisse modifier les chiffres d une ligne manuelle', () => {
    const { container } = render(<LigneForm line={MANUELLE} />)
    expect(screen.getByLabelText('Jours vendus')).toHaveProperty('readOnly', false)
    expect(screen.getByLabelText('TJM (€)')).toHaveProperty('readOnly', false)
    expect(container.querySelector('input[name="joursVendus"]')).not.toBeNull()
    expect(container.querySelector('input[name="tjmEuros"]')).not.toBeNull()
  })

  it('ne propose pas de modifier des chiffres repris de la propale', () => {
    // Un champ qu'on peut remplir mais dont l'enregistrement sera refusé est
    // pire que pas de champ du tout.
    const { container } = render(<LigneForm line={REPRISE} />)
    expect(screen.getByLabelText('Jours vendus')).toHaveProperty('readOnly', true)
    expect(screen.getByLabelText('TJM (€)')).toHaveProperty('readOnly', true)
    // Et rien n'est soumis : le formulaire n'envoie pas ce qu'il sait refusé.
    expect(container.querySelector('input[name="joursVendus"]')).toBeNull()
    expect(container.querySelector('input[name="tjmEuros"]')).toBeNull()
  })

  it('dit en toutes lettres d où viennent ces chiffres', () => {
    // Aucune information portée par la seule couleur, ni par le seul grisé
    // d'un champ.
    render(<LigneForm line={REPRISE} />)
    expect(screen.getByText(/propale Dolibarr/i)).not.toBeNull()
  })

  it('ne mentionne aucune propale sur une ligne manuelle', () => {
    render(<LigneForm line={MANUELLE} />)
    expect(screen.queryByText(/propale Dolibarr/i)).toBeNull()
  })

  it('laisse modifier le libellé et l unité, même sur une ligne reprise', () => {
    const { container } = render(<LigneForm line={REPRISE} />)
    expect(screen.getByLabelText('Libellé')).toHaveProperty('readOnly', false)
    expect(container.querySelector('select[name="displayUnit"]')).not.toBeNull()
  })

  it('annonce le refus du service plutôt que de se recomposer en silence', async () => {
    modifierLigne.mockResolvedValue({
      ok: false,
      message: 'Les jours vendus proviennent de la propale Dolibarr.',
    })
    render(<LigneForm line={REPRISE} />)

    soumettre()

    // `role="alert"` : un refus interrompt. Et il ne s'affiche pas dans la
    // tonalité d'une réussite — le ton se transmet de bout en bout.
    const alerte = await screen.findByRole('alert')
    expect(alerte.textContent).toContain('Les jours vendus proviennent de la propale Dolibarr.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('confirme l enregistrement quand le service accepte', async () => {
    render(<LigneForm line={MANUELLE} />)
    soumettre()

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Prestation enregistrée.')
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('ne confirme rien tant que rien n a été soumis', () => {
    render(<LigneForm line={MANUELLE} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
