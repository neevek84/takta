// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CellForm } from './CellForm'
import { DEFAULT_SLOTS } from '@/services/settings'
import type { LineForGrid } from '@/services/missions'

const ligne: LineForGrid = {
  id: 'l1',
  label: 'Consultant ITSM',
  missionLabel: 'ITSM',
  clientName: 'ACME',
  displayUnit: 'JOUR',
  minutesParJour: 480,
  soldCentiemes: 3000,
  allowedSlotIds: [],
}

const ligneRestreinte: LineForGrid = { ...ligne, allowedSlotIds: ['matin', 'apres-midi'] }

function renderForm(
  overrides: Partial<React.ComponentProps<typeof CellForm>> = {},
): {
  onSubmit: ReturnType<typeof vi.fn>
  onDelete: ReturnType<typeof vi.fn>
  onCancel: ReturnType<typeof vi.fn>
  unmount: () => void
} {
  const onSubmit = vi.fn()
  const onDelete = vi.fn()
  const onCancel = vi.fn()
  const { unmount } = render(
    <CellForm
      date="2026-03-10"
      etat={{ kind: 'VIDE' }}
      line={ligne}
      slots={DEFAULT_SLOTS}
      onSubmit={onSubmit}
      onDelete={onDelete}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onDelete, onCancel, unmount }
}

function duree(): HTMLInputElement {
  return screen.getByLabelText('Durée (heures)') as HTMLInputElement
}

function creneau(): HTMLSelectElement {
  return screen.getByLabelText('Créneau') as HTMLSelectElement
}

function enregistrer(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
}

describe('CellForm', () => {
  afterEach(cleanup)

  it('rappelle la date saisie', () => {
    renderForm()
    expect(screen.getByText(/2026-03-10/)).toBeDefined()
  })

  it('part d une durée vide et de la journée entière sur une case vide', () => {
    renderForm()
    expect(duree().value).toBe('')
    expect(creneau().value).toBe('')
  })

  it('pré-remplit la durée et le créneau d une valeur libre', () => {
    renderForm({ etat: { kind: 'LIBRE', minutes: 210, slotId: 'nuit', eclatee: false } })
    expect(duree().value).toBe('3,5')
    expect(creneau().value).toBe('nuit')
  })

  it('pré-remplit une demi-journée avec ses minutes réelles', () => {
    renderForm({ etat: { kind: 'DEMI', slotId: 'matin' } })
    expect(duree().value).toBe('4')
    expect(creneau().value).toBe('matin')
  })

  it('convertit la durée saisie en minutes', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(duree(), { target: { value: '3,5' } })
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(210, '')
  })

  it('accepte la notation en heures et minutes', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(duree(), { target: { value: '3h30' } })
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(210, '')
  })

  it('transmet le créneau choisi', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(duree(), { target: { value: '8' } })
    fireEvent.change(creneau(), { target: { value: 'nuit' } })
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(480, 'nuit')
  })

  it('refuse une durée inexploitable sans rien transmettre', () => {
    const { onSubmit } = renderForm()
    for (const valeur of ['', '0', '-2', 'abc', '25']) {
      fireEvent.change(duree(), { target: { value: valeur } })
      enregistrer()
    }
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('durée')
  })

  it('propose les créneaux hors des trois prédéfinis, la nuit comprise', () => {
    renderForm()
    const valeurs = Array.from(creneau().options).map((o) => o.value)
    expect(valeurs).toEqual(['', 'matin', 'apres-midi', 'nuit'])
  })

  // `allowedSlotIds` : signalement, jamais refus.
  it('signale un créneau non autorisé sans le rendre inchoisissable', () => {
    const { onSubmit } = renderForm({ line: ligneRestreinte })
    const option = Array.from(creneau().options).find((o) => o.value === 'nuit')!
    expect(option.disabled).toBe(false)
    expect(option.textContent).toContain('hors créneaux autorisés')

    fireEvent.change(duree(), { target: { value: '3' } })
    fireEvent.change(creneau(), { target: { value: 'nuit' } })
    expect(screen.getByTestId('signalement-creneau').textContent).toContain('autorisé')

    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(180, 'nuit')
  })

  it('ne signale rien sur un créneau autorisé', () => {
    renderForm({ line: ligneRestreinte })
    fireEvent.change(creneau(), { target: { value: 'matin' } })
    expect(screen.queryByTestId('signalement-creneau')).toBeNull()
  })

  it('avertit avant de remplacer une journée éclatée en plusieurs créneaux', () => {
    renderForm({ etat: { kind: 'LIBRE', minutes: 480, slotId: '', eclatee: true } })
    expect(screen.getByTestId('avertissement-eclatee').textContent).toContain('plusieurs créneaux')
  })

  it('n avertit pas sur une case ordinaire', () => {
    renderForm({ etat: { kind: 'LIBRE', minutes: 180, slotId: '', eclatee: false } })
    expect(screen.queryByTestId('avertissement-eclatee')).toBeNull()
  })

  it('supprime la saisie sur demande', () => {
    const { onDelete } = renderForm({ etat: { kind: 'JOURNEE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la saisie' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('n offre pas de supprimer une case déjà vide', () => {
    renderForm({ etat: { kind: 'VIDE' } })
    expect(screen.queryByRole('button', { name: 'Supprimer la saisie' })).toBeNull()
  })

  it('annule sans rien transmettre', () => {
    const { onSubmit, onCancel, onDelete } = renderForm()
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })
})

/**
 * C2 — la boîte s'annonce comme une boîte de dialogue : elle doit donc se
 * comporter comme telle. Un raccourci clavier (Maj+Entrée, touche Menu) a été
 * ajouté pour ouvrir ce formulaire sans souris ; sans focus déplacé, sans
 * piège de focus et sans Échap, ce raccourci ouvre un panneau que personne ne
 * peut atteindre — la mesure de la revue : 21 tabulations à travers vingt
 * cases du calendrier avant d'arriver au premier champ.
 */
describe('CellForm — boîte de dialogue au clavier', () => {
  afterEach(cleanup)

  it('se déclare boîte de dialogue modale', () => {
    renderForm()
    const boite = screen.getByRole('dialog')
    expect(boite.getAttribute('aria-modal')).toBe('true')
    expect(boite.getAttribute('aria-label')).toBe('Saisie libre du 2026-03-10')
  })

  it('porte le focus sur le champ de durée à l ouverture', () => {
    renderForm()
    expect(document.activeElement).toBe(duree())
  })

  it('ferme sur Échap sans rien enregistrer', () => {
    const { onSubmit, onDelete, onCancel } = renderForm({ etat: { kind: 'JOURNEE' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })

  // Échap est écouté sur le document, pas sur le panneau : un `<div>` non
  // focalisable cesserait de recevoir la touche dès que le focus le quitte.
  it('ferme sur Échap frappé depuis un bouton de la boîte', () => {
    const { onCancel } = renderForm()
    const annuler = screen.getByRole('button', { name: 'Annuler' })
    annuler.focus()
    fireEvent.keyDown(annuler, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('retient le focus dans la boîte au tabulateur', () => {
    renderForm({ etat: { kind: 'JOURNEE' } })
    const annuler = screen.getByRole('button', { name: 'Annuler' })

    // Dernier élément focalisable : la tabulation suivante sortirait de la
    // boîte, c'est-à-dire dans la grille du calendrier restée derrière.
    annuler.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(duree())

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(annuler)
  })

  it('rend le focus au déclencheur à la fermeture', () => {
    // Tient lieu de case du calendrier : c'est elle qui avait le focus quand
    // Maj+Entrée a ouvert la boîte, c'est à elle qu'il doit revenir.
    const declencheur = document.createElement('button')
    document.body.appendChild(declencheur)
    declencheur.focus()

    const { unmount } = renderForm()
    expect(document.activeElement).toBe(duree())

    unmount()
    expect(document.activeElement).toBe(declencheur)
    declencheur.remove()
  })
})
