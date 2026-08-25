// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const { modifierLigne, chargerImpactPrestation } = vi.hoisted(() => ({
  modifierLigne: vi.fn(),
  chargerImpactPrestation: vi.fn(),
}))
// `GestionPrestation` est rendu par ce formulaire et lit les mêmes actions :
// un double partiel le ferait tomber au premier clic.
vi.mock('./actions', () => ({
  modifierLigne,
  chargerImpactPrestation,
  detruirePrestation: vi.fn(),
  rangerPrestation: vi.fn(),
}))

// `vi.mock` est hissé au-dessus des imports : le server action n'est jamais
// chargé, seul le composant l'est.
import { LigneForm } from './LigneForm'

beforeEach(() => {
  modifierLigne.mockReset().mockResolvedValue({ ok: true })
  chargerImpactPrestation
    .mockReset()
    .mockResolvedValue({ saisies: 0, saisiesValidees: 0, crasValides: 0, correspondances: 0 })
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
const DEPUIS_COMMANDE = { ...MANUELLE, engagementSource: 'DOLIBARR_COMMANDE' as const }

/**
 * La visibilité du panneau est décidée par `LigneRow`, pas par ce composant :
 * il rend directement ses champs, et `onClose` est le seul geste de
 * fermeture qui lui reste.
 */
function rendre(line: Parameters<typeof LigneForm>[0]['line'], onClose = vi.fn()) {
  return { onClose, ...render(<LigneForm line={line} onClose={onClose} />) }
}

function soumettre(): void {
  const form = document.querySelector('form')
  if (form === null) throw new Error('formulaire introuvable')
  fireEvent.submit(form)
}

describe('LigneForm', () => {
  it('appelle onClose sans rien enregistrer', () => {
    const { onClose } = rendre(MANUELLE)
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(modifierLigne).not.toHaveBeenCalled()
  })

  it('ne propose pas non plus de modifier des chiffres repris d une commande', () => {
    // Le verrou testait « est-ce une propale ? ». Une prestation reprise d'une
    // commande redevenait donc modifiable, et ses jours vendus pouvaient
    // diverger du document — sur les chiffres qui seront facturés.
    const { container } = rendre(DEPUIS_COMMANDE)

    expect(screen.getByLabelText('Jours vendus')).toHaveProperty('readOnly', true)
    expect(container.querySelector('input[name="joursVendus"]')).toBeNull()
    expect(container.querySelector('input[name="tjmEuros"]')).toBeNull()
    expect(document.body.textContent).toContain('commande Dolibarr')
  })

  it('affiche les chiffres vendus dans leurs unités lisibles', () => {
    rendre(MANUELLE)
    expect(screen.getByLabelText('Jours vendus')).toHaveProperty('value', '30')
    expect(screen.getByLabelText('TJM (€)')).toHaveProperty('value', '800')
  })

  it('transporte la prestation concernée, sans quoi l écriture viserait une autre', () => {
    const { container } = rendre({ ...MANUELLE, id: 'l-42' })
    expect(container.querySelector('input[name="lineId"]')).toHaveProperty('value', 'l-42')
  })

  it('laisse modifier les chiffres d une ligne manuelle', () => {
    const { container } = rendre(MANUELLE)
    expect(screen.getByLabelText('Jours vendus')).toHaveProperty('readOnly', false)
    expect(screen.getByLabelText('TJM (€)')).toHaveProperty('readOnly', false)
    expect(container.querySelector('input[name="joursVendus"]')).not.toBeNull()
    expect(container.querySelector('input[name="tjmEuros"]')).not.toBeNull()
  })

  it('ne propose pas de modifier des chiffres repris de la propale', () => {
    // Un champ qu'on peut remplir mais dont l'enregistrement sera refusé est
    // pire que pas de champ du tout.
    const { container } = rendre(REPRISE)
    expect(screen.getByLabelText('Jours vendus')).toHaveProperty('readOnly', true)
    expect(screen.getByLabelText('TJM (€)')).toHaveProperty('readOnly', true)
    // Et rien n'est soumis : le formulaire n'envoie pas ce qu'il sait refusé.
    expect(container.querySelector('input[name="joursVendus"]')).toBeNull()
    expect(container.querySelector('input[name="tjmEuros"]')).toBeNull()
  })

  it('dit en toutes lettres d où viennent ces chiffres', () => {
    // Aucune information portée par la seule couleur, ni par le seul grisé
    // d'un champ.
    rendre(REPRISE)
    expect(screen.getByText(/propale Dolibarr/i)).not.toBeNull()
  })

  it('ne mentionne aucune propale sur une ligne manuelle', () => {
    rendre(MANUELLE)
    expect(screen.queryByText(/propale Dolibarr/i)).toBeNull()
  })

  it('laisse modifier l unité, même sur une ligne reprise', () => {
    // Le libellé, lui, se renomme depuis `RenamePrestation` — plus depuis ce
    // formulaire, qui ne porte plus que les chiffres.
    const { container } = rendre(REPRISE)
    expect(screen.queryByLabelText('Libellé')).toBeNull()
    expect(container.querySelector('select[name="displayUnit"]')).not.toBeNull()
  })

  it('annonce le refus du service plutôt que de se recomposer en silence', async () => {
    modifierLigne.mockResolvedValue({
      ok: false,
      message: 'Les jours vendus proviennent de la propale Dolibarr.',
    })
    rendre(REPRISE)

    soumettre()

    // `role="alert"` : un refus interrompt. Et il ne s'affiche pas dans la
    // tonalité d'une réussite — le ton se transmet de bout en bout.
    const alerte = await screen.findByRole('alert')
    expect(alerte.textContent).toContain('Les jours vendus proviennent de la propale Dolibarr.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('confirme l enregistrement quand le service accepte', async () => {
    rendre(MANUELLE)
    soumettre()

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('Prestation enregistrée.')
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Le geste manquait : une prestation créée par erreur, ou terminée, restait
  // dans la grille de saisie pour toujours.
  it('donne accès à l archivage et à la suppression de la prestation', () => {
    rendre(MANUELLE)
    expect(
      screen.getByRole('button', { name: /Archiver ou supprimer « Consultant ITSM »/ }),
    ).toBeTruthy()
  })

  // Le verrou d'engagement porte sur les jours vendus et le TJM, pas sur le
  // rangement : une prestation reprise se range comme une autre.
  it('le propose aussi sur une prestation reprise de Dolibarr', () => {
    rendre(REPRISE)
    expect(screen.getByRole('button', { name: /Archiver ou supprimer/ })).toBeTruthy()
  })

  it('ne confirme rien tant que rien n a été soumis', () => {
    rendre(MANUELLE)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
