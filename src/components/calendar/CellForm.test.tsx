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
      journeeDebutMinute={540}
      journeeFinMinute={1080}
      onSubmit={onSubmit}
      onDelete={onDelete}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSubmit, onDelete, onCancel, unmount }
}

function debut(): HTMLInputElement {
  return screen.getByLabelText('Heure de début') as HTMLInputElement
}

function fin(): HTMLInputElement {
  return screen.getByLabelText('Heure de fin') as HTMLInputElement
}

function creneau(): HTMLSelectElement {
  return screen.getByLabelText('Créneau') as HTMLSelectElement
}

function dureeCalculee(): string {
  return screen.getByTestId('duree-calculee').textContent ?? ''
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

  // Le défaut que ce lot corrige : le formulaire demandait une durée et un
  // créneau, et l'application décidait seule que le bloc commençait à 8 h. Le
  // choix était fait, et rien ne le disait — ni à l'écran, ni dans l'agenda.
  it('demande un début et une fin, jamais une durée', () => {
    renderForm()
    expect(debut()).toBeDefined()
    expect(fin()).toBeDefined()
    expect(screen.queryByLabelText('Durée (heures)')).toBeNull()
  })

  it('part de la plage journée sur une case vide', () => {
    renderForm()
    expect([debut().value, fin().value]).toEqual(['09:00', '18:00'])
    expect(creneau().value).toBe('')
  })

  // M1 — les horaires se figent à l'écriture, exactement comme le facteur.
  // Le formulaire les **recalculait** depuis la plage journée courante : une
  // saisie écrite de 8 h à 16 h s'ouvrait sur 10 h – 18 h le jour où
  // l'administrateur déplaçait la journée de travail, et l'enregistrer sans
  // rien changer écrivait ces heures-là. Le gel avait tenu en base jusqu'à ce
  // que le lecteur le casse.
  it('pré-remplit les bornes figées d une journée entière', () => {
    renderForm({ etat: { kind: 'JOURNEE', bornes: { startMinute: 480, endMinute: 960 } } })
    expect([debut().value, fin().value]).toEqual(['08:00', '16:00'])
  })

  it('pré-remplit les bornes figées d une demi-journée', () => {
    renderForm({
      etat: { kind: 'DEMI', slotId: 'matin', bornes: { startMinute: 480, endMinute: 720 } },
    })
    expect([debut().value, fin().value]).toEqual(['08:00', '12:00'])
    expect(creneau().value).toBe('matin')
  })

  // « Un CRA validé rend les mêmes chiffres après un changement de réglage » :
  // ici, les mêmes heures. Seule la plage journée courante change entre les
  // deux rendus — et le formulaire n'a rien à en tirer.
  it('affiche les mêmes heures quel que soit le réglage courant de la journée', () => {
    const etat = { kind: 'JOURNEE', bornes: { startMinute: 480, endMinute: 960 } } as const

    renderForm({ etat, journeeDebutMinute: 540, journeeFinMinute: 1080 })
    const avant = [debut().value, fin().value]
    cleanup()

    renderForm({ etat, journeeDebutMinute: 600, journeeFinMinute: 1140 })
    expect([debut().value, fin().value]).toEqual(avant)
    expect(avant).toEqual(['08:00', '16:00'])
  })

  // L'état que la cinématique vient de poser n'a pas encore d'heures : elles
  // n'existeront qu'à l'écriture, et c'est la plage journée courante qui les
  // donnera. C'est le seul cas où le formulaire a le droit de les calculer.
  it('retombe sur la plage journée pour un cran que le clic vient de poser', () => {
    renderForm({ etat: { kind: 'JOURNEE' } })
    // 8 h saisies dans une plage de 9 h : le bloc s'arrête à 17 h.
    expect([debut().value, fin().value]).toEqual(['09:00', '17:00'])
  })

  it('pré-remplit les bornes figées d une valeur libre', () => {
    renderForm({
      etat: {
        kind: 'LIBRE',
        minutes: 210,
        slotId: 'nuit',
        startMinute: 1320,
        endMinute: 90,
        eclatee: false,
      },
    })
    expect([debut().value, fin().value]).toEqual(['22:00', '01:30'])
    expect(creneau().value).toBe('nuit')
  })

  it('pré-remplit une demi-journée que le clic vient de poser avec les bornes de son créneau', () => {
    renderForm({ etat: { kind: 'DEMI', slotId: 'matin' } })
    expect([debut().value, fin().value]).toEqual(['09:00', '13:00'])
    expect(creneau().value).toBe('matin')
  })

  // « La durée en découle » : elle s'affiche, elle ne se saisit plus.
  it('affiche la durée déduite des deux heures', () => {
    renderForm()
    fireEvent.change(debut(), { target: { value: '09:00' } })
    fireEvent.change(fin(), { target: { value: '12:30' } })
    expect(dureeCalculee()).toContain('3h30')
  })

  it('transmet les minutes déduites et les deux bornes', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(debut(), { target: { value: '09:00' } })
    fireEvent.change(fin(), { target: { value: '12:30' } })
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(210, '', 540, 750)
  })

  // Le porteur travaille parfois la nuit : une fin antérieure au début n'est
  // pas une erreur de saisie, c'est un bloc qui franchit minuit.
  it('accepte une fin antérieure au début et compte les minutes par-dessus minuit', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(debut(), { target: { value: '22:00' } })
    fireEvent.change(fin(), { target: { value: '02:00' } })
    expect(dureeCalculee()).toContain('4h')
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(240, '', 1320, 120)
  })

  it('compte une journée pleine quand les deux heures coïncident', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(debut(), { target: { value: '09:00' } })
    fireEvent.change(fin(), { target: { value: '09:00' } })
    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(1440, '', 540, 540)
  })

  // Le chemin rapide reste : le créneau nommé **pré-remplit**, il ne verrouille
  // rien. On garde la vitesse, et on voit ce qui partira.
  it('pré-remplit les deux heures quand on choisit un créneau', () => {
    renderForm()
    fireEvent.change(creneau(), { target: { value: 'apres-midi' } })
    expect([debut().value, fin().value]).toEqual(['14:00', '18:00'])
  })

  it('laisse ajuster les heures après un créneau, sans perdre sa trace', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(creneau(), { target: { value: 'matin' } })
    fireEvent.change(fin(), { target: { value: '12:00' } })
    enregistrer()
    // Le créneau reste comme trace de l'origine, les heures sont celles qu'on
    // a réellement saisies.
    expect(onSubmit).toHaveBeenCalledWith(180, 'matin', 540, 720)
  })

  it('revient à la plage journée quand on repasse à la journée entière', () => {
    renderForm()
    fireEvent.change(creneau(), { target: { value: 'apres-midi' } })
    fireEvent.change(creneau(), { target: { value: '' } })
    expect([debut().value, fin().value]).toEqual(['09:00', '18:00'])
  })

  it('refuse une heure vide sans rien transmettre', () => {
    const { onSubmit } = renderForm()
    fireEvent.change(debut(), { target: { value: '' } })
    enregistrer()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('heure')
  })

  it('propose les créneaux hors des trois prédéfinis, la nuit comprise', () => {
    renderForm()
    const valeurs = Array.from(creneau().options).map((o) => o.value)
    expect(valeurs).toEqual(['', 'matin', 'apres-midi', 'nuit'])
  })

  // « AM » et « PM » partout : le porteur les veut aussi dans le formulaire,
  // pour lever l'ambiguïté du matin et de l'après-midi. Pas « ½ AM » ici : on
  // y saisit un bloc horaire, qui n'est pas forcément une demi-journée.
  it('précise la moitié de journée de chaque créneau', () => {
    renderForm()
    const libelles = Array.from(creneau().options).map((o) => o.textContent)
    expect(libelles).toEqual(['Journée entière', 'Matin (AM)', 'Après-midi (PM)', 'Nuit'])
  })

  // `allowedSlotIds` : signalement, jamais refus.
  it('signale un créneau non autorisé sans le rendre inchoisissable', () => {
    const { onSubmit } = renderForm({ line: ligneRestreinte })
    const option = Array.from(creneau().options).find((o) => o.value === 'nuit')!
    expect(option.disabled).toBe(false)
    expect(option.textContent).toContain('hors créneaux autorisés')

    fireEvent.change(creneau(), { target: { value: 'nuit' } })
    expect(screen.getByTestId('signalement-creneau').textContent).toContain('autorisé')

    enregistrer()
    expect(onSubmit).toHaveBeenCalledWith(480, 'nuit', 1320, 360)
  })

  it('ne signale rien sur un créneau autorisé', () => {
    renderForm({ line: ligneRestreinte })
    fireEvent.change(creneau(), { target: { value: 'matin' } })
    expect(screen.queryByTestId('signalement-creneau')).toBeNull()
  })

  it('avertit avant de remplacer une journée éclatée en plusieurs créneaux', () => {
    renderForm({
      etat: {
        kind: 'LIBRE',
        minutes: 480,
        slotId: '',
        startMinute: 540,
        endMinute: 1080,
        eclatee: true,
      },
    })
    expect(screen.getByTestId('avertissement-eclatee').textContent).toContain('plusieurs créneaux')
  })

  it('n avertit pas sur une case ordinaire', () => {
    renderForm({
      etat: {
        kind: 'LIBRE',
        minutes: 180,
        slotId: '',
        startMinute: 540,
        endMinute: 720,
        eclatee: false,
      },
    })
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
    expect(boite.getAttribute('aria-label')).toBe('Saisie du 2026-03-10')
  })

  it('porte le focus sur la première heure à l ouverture', () => {
    renderForm()
    expect(document.activeElement).toBe(debut())
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
    expect(document.activeElement).toBe(debut())

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
    expect(document.activeElement).toBe(debut())

    unmount()
    expect(document.activeElement).toBe(declencheur)
    declencheur.remove()
  })
})
