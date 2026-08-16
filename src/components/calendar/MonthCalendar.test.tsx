// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { MonthCalendar } from './MonthCalendar'
import { buildMonthDays } from '@/core/month/build'
import { DEFAULT_SLOTS } from '@/services/settings'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'

const days = buildMonthDays('2026-03', [1, 2, 3, 4, 5], ['2026-03-02'])

const ligneJour: LineForGrid = {
  id: 'l1',
  label: 'Consultant ITSM',
  missionLabel: 'ITSM',
  clientName: 'ACME',
  displayUnit: 'JOUR',
  minutesParJour: 480,
  soldCentiemes: 3000,
  allowedSlotIds: [],
}

const ligneHeure: LineForGrid = { ...ligneJour, id: 'l2', label: 'Astreinte', displayUnit: 'HEURE' }

function entree(over: Partial<MonthEntry>): MonthEntry {
  return {
    id: 'e', lineId: 'l1', date: '2026-03-10', minutes: 480,
    kind: 'REALISE', slotId: '', minutesParJour: 480, ...over,
  }
}

function renderCalendar(
  overrides: Partial<React.ComponentProps<typeof MonthCalendar>> = {},
): ReturnType<typeof render> {
  return render(
    <MonthCalendar
      days={days}
      line={ligneJour}
      slots={DEFAULT_SLOTS}
      entries={[]}
      autresLignes={[]}
      toutLeMois={false}
      onApply={vi.fn(async () => true)}
      onRange={vi.fn(async () => {})}
      onFormulaire={vi.fn()}
      {...overrides}
    />,
  )
}

function caseDu(date: string): HTMLButtonElement {
  return screen.getByTestId(`case-${date}`) as HTMLButtonElement
}

/** La valeur seule, sans le numéro du jour qui la précède dans la case. */
function valeurDu(date: string): HTMLElement {
  return screen.getByTestId(`valeur-${date}`)
}

/**
 * Les classes une à une, jamais la chaîne entière : `toContain('bg-off')` sur
 * `className` accepterait `bg-off-strong`, et rendrait le fond d'un week-end
 * indistinguable de celui d'un férié.
 */
function classes(el: Element): string[] {
  return el.className.split(/\s+/).filter((c) => c !== '')
}

describe('MonthCalendar', () => {
  afterEach(cleanup)

  it('affiche sept en-têtes de jours', () => {
    renderCalendar()
    expect(screen.getAllByTestId(/^entete-jour-/)).toHaveLength(7)
  })

  it('abrège les en-têtes pour le téléphone tout en gardant la forme longue', () => {
    renderCalendar()
    const lundi = screen.getByTestId('entete-jour-1')
    expect(lundi.textContent).toContain('L')
    expect(lundi.textContent).toContain('Lun')
  })

  it('affiche une case par jour du mois', () => {
    renderCalendar()
    expect(screen.getAllByTestId(/^case-2026-03-/)).toHaveLength(31)
  })

  it('range la grille en sept colonnes fixes', () => {
    const { container } = renderCalendar()
    expect(classes(container.querySelector('[data-testid="grille-calendrier"]')!)).toContain(
      'grid-cols-7',
    )
  })

  it('garde une cible tactile d au moins 44 points', () => {
    renderCalendar()
    // `touch-target` plutôt que `min-h-11 min-w-11` : c'est l'utilitaire que
    // `globals.css` déclare à 2,75rem sur les deux dimensions — soit 44 px —,
    // et dont `design-system.test.ts` vérifie les deux déclarations. Deux
    // façons d'écrire 44 points en donneraient deux à maintenir.
    expect(classes(caseDu('2026-03-10'))).toContain('touch-target')
  })

  it('grise les week-ends et les fériés sans les interdire', () => {
    renderCalendar()
    const dimanche = caseDu('2026-03-01')
    const ferie = caseDu('2026-03-02')
    expect(classes(dimanche)).toContain('bg-off')
    expect(classes(ferie)).toContain('bg-off-strong')
    expect(dimanche.disabled).toBe(false)
    expect(ferie.disabled).toBe(false)
  })

  it('ne confie pas à la seule couleur le fait qu un jour est chômé', () => {
    // Un motif et un intitulé doublent la teinte : sans eux, la distinction
    // disparaît pour qui ne perçoit pas la nuance de fond.
    renderCalendar()
    expect(classes(caseDu('2026-03-01'))).toContain('pattern-stripes')
    expect(classes(caseDu('2026-03-02'))).toContain('pattern-dots')
    expect(caseDu('2026-03-01').getAttribute('aria-label')).toContain('Jour non ouvré')
    expect(caseDu('2026-03-02').getAttribute('aria-label')).toContain('Jour férié')
  })

  it('reste parcourable au clavier', () => {
    // Des vrais boutons, sans piège de tabulation : la grille se parcourt à la
    // tabulation et le contour de focus de `globals.css` s'y applique.
    renderCalendar()
    const c = caseDu('2026-03-10')
    expect(c.tagName).toBe('BUTTON')
    expect(c.getAttribute('tabindex')).toBeNull()
    c.focus()
    expect(document.activeElement).toBe(c)
  })

  describe('cinématique au clic', () => {
    it('pose une journée sur une case vide', async () => {
      const onApply = vi.fn(async () => true)
      renderCalendar({ onApply })

      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() => expect(onApply).toHaveBeenCalledWith('2026-03-10', { kind: 'JOURNEE' }))
    })

    it('passe d une journée à la demi-journée du matin', async () => {
      const onApply = vi.fn(async () => true)
      renderCalendar({ onApply, entries: [entree({ minutes: 480, slotId: '' })] })

      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() =>
        expect(onApply).toHaveBeenCalledWith('2026-03-10', { kind: 'DEMI', slotId: 'matin' }),
      )
    })

    it('vide la case après la dernière demi-journée', async () => {
      const onApply = vi.fn(async () => true)
      renderCalendar({ onApply, entries: [entree({ minutes: 240, slotId: 'apres-midi' })] })

      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() => expect(onApply).toHaveBeenCalledWith('2026-03-10', { kind: 'VIDE' }))
    })

    // Le test qui protège contre la perte silencieuse.
    it('n applique rien sur une case à valeur libre : elle rouvre son formulaire', async () => {
      const onApply = vi.fn(async () => true)
      const onFormulaire = vi.fn()
      renderCalendar({ onApply, onFormulaire, entries: [entree({ minutes: 180, slotId: '' })] })

      fireEvent.click(caseDu('2026-03-10'))

      await waitFor(() =>
        expect(onFormulaire).toHaveBeenCalledWith('2026-03-10', {
          kind: 'LIBRE', minutes: 180, slotId: '', eclatee: false,
        }),
      )
      expect(onApply).not.toHaveBeenCalled()
    })

    it('ouvre le formulaire d une prestation facturée à l heure, sans passer par 1 jour', async () => {
      const onApply = vi.fn(async () => true)
      const onFormulaire = vi.fn()
      renderCalendar({ line: ligneHeure, entries: [], onApply, onFormulaire })

      fireEvent.click(caseDu('2026-03-10'))

      await waitFor(() =>
        expect(onFormulaire).toHaveBeenCalledWith('2026-03-10', { kind: 'VIDE' }),
      )
      expect(onApply).not.toHaveBeenCalled()
    })

    it('ouvre le formulaire au clic droit', () => {
      const onFormulaire = vi.fn()
      const onApply = vi.fn(async () => true)
      renderCalendar({ onApply, onFormulaire })

      fireEvent.contextMenu(caseDu('2026-03-11'))

      expect(onFormulaire).toHaveBeenCalledWith('2026-03-11', { kind: 'VIDE' })
      expect(onApply).not.toHaveBeenCalled()
    })

    it('n ouvre pas de menu contextuel du navigateur', () => {
      renderCalendar()
      const evenement = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      caseDu('2026-03-11').dispatchEvent(evenement)
      expect(evenement.defaultPrevented).toBe(true)
    })

    // L'équivalent au pouce du clic droit : sans lui, le téléphone n'aurait
    // aucun moyen d'atteindre le formulaire.
    it('ouvre le formulaire sur un appui long, sans faire avancer la case', () => {
      vi.useFakeTimers()
      try {
        const onApply = vi.fn(async () => true)
        const onFormulaire = vi.fn()
        renderCalendar({ onApply, onFormulaire })

        const c = caseDu('2026-03-11')
        fireEvent.pointerDown(c)
        act(() => {
          vi.advanceTimersByTime(500)
        })
        fireEvent.pointerUp(c)
        // Le navigateur émet le clic derrière l'appui long : la case ne doit
        // pas avancer d'un cran par-dessus le formulaire qui vient de s'ouvrir.
        fireEvent.click(c)

        expect(onFormulaire).toHaveBeenCalledWith('2026-03-11', { kind: 'VIDE' })
        expect(onApply).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    // Ni le clic droit ni l'appui long ne se produisent au clavier : sans ce
    // raccourci, le formulaire de valeur libre serait inatteignable par
    // tabulation seule.
    it('ouvre le formulaire au clavier avec Maj+Entrée', () => {
      const onApply = vi.fn(async () => true)
      const onFormulaire = vi.fn()
      renderCalendar({ onApply, onFormulaire })

      fireEvent.keyDown(caseDu('2026-03-11'), { key: 'Enter', shiftKey: true })

      expect(onFormulaire).toHaveBeenCalledWith('2026-03-11', { kind: 'VIDE' })
      expect(onApply).not.toHaveBeenCalled()
    })

    it('ouvre le formulaire au clavier avec la touche Menu', () => {
      const onApply = vi.fn(async () => true)
      const onFormulaire = vi.fn()
      renderCalendar({ onApply, onFormulaire })

      fireEvent.keyDown(caseDu('2026-03-11'), { key: 'ContextMenu' })

      expect(onFormulaire).toHaveBeenCalledWith('2026-03-11', { kind: 'VIDE' })
      expect(onApply).not.toHaveBeenCalled()
    })

    it('un Entrée seul, sans Maj, continue de faire avancer la case', async () => {
      const onApply = vi.fn(async () => true)
      const onFormulaire = vi.fn()
      renderCalendar({ onApply, onFormulaire })

      fireEvent.keyDown(caseDu('2026-03-11'), { key: 'Enter' })

      expect(onFormulaire).not.toHaveBeenCalled()
    })
  })

  describe('affichage des états', () => {
    it('affiche 1 pour une journée entière', () => {
      renderCalendar({ entries: [entree({ minutes: 480, slotId: '' })] })
      // Sur la valeur seule : le numéro du jour, « 10 », contient déjà un « 1 ».
      expect(valeurDu('2026-03-10').textContent).toBe('1')
    })

    it('affiche l initiale du créneau pour une demi-journée', () => {
      renderCalendar({ entries: [entree({ minutes: 240, slotId: 'apres-midi' })] })
      expect(valeurDu('2026-03-10').textContent).toBe('½ A')
      expect(caseDu('2026-03-10').title).toContain('Après-midi')
    })

    it('affiche les heures d une valeur libre', () => {
      renderCalendar({ entries: [entree({ minutes: 180, slotId: 'nuit' })] })
      expect(valeurDu('2026-03-10').textContent).toBe('3h')
    })

    it('distingue le prévisionnel du réalisé', () => {
      renderCalendar({ entries: [entree({ kind: 'PREVISIONNEL' })] })
      expect(classes(caseDu('2026-03-10'))).toContain('italic')
    })

    it('laisse vide une case sans saisie', () => {
      renderCalendar()
      expect(valeurDu('2026-03-10').textContent).toBe('')
    })
  })

  describe('affichage optimiste', () => {
    it('montre le cran suivant sans attendre le serveur', async () => {
      renderCalendar({ onApply: vi.fn(async () => true) })

      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() => expect(valeurDu('2026-03-10').textContent).toBe('1'))
    })

    it('revient à l état serveur quand l écriture est refusée', async () => {
      renderCalendar({ onApply: vi.fn(async () => false) })

      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() => expect(valeurDu('2026-03-10').textContent).toBe(''))
    })

    it('reprend les saisies du serveur quand elles changent', () => {
      const { rerender } = renderCalendar()
      expect(valeurDu('2026-03-10').textContent).toBe('')

      rerender(
        <MonthCalendar
          days={days}
          line={ligneJour}
          slots={DEFAULT_SLOTS}
          entries={[entree({ minutes: 240, slotId: 'matin' })]}
          autresLignes={[]}
          toutLeMois={false}
          onApply={vi.fn(async () => true)}
          onRange={vi.fn(async () => {})}
          onFormulaire={vi.fn()}
        />,
      )
      expect(valeurDu('2026-03-10').textContent).toBe('½ M')
    })
  })

  const ligneB: LineForGrid = {
    ...ligneJour,
    id: 'lB',
    label: 'Consultant ITSM Nuit',
    soldCentiemes: 1000,
  }

  const surLigneB: MonthEntry[] = [
    { id: 'b1', lineId: 'lB', date: '2026-03-10', minutes: 480, kind: 'REALISE', slotId: '', minutesParJour: 480 },
  ]

  describe('Cette prestation ou tout le mois', () => {
    it('n affiche que la prestation sélectionnée par défaut', () => {
      renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: false })
      expect(screen.queryByTestId('autre-lB-2026-03-10')).toBeNull()
    })

    it('affiche les autres prestations en mode « Tout le mois »', () => {
      renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: true })
      const badge = screen.getByTestId('autre-lB-2026-03-10')
      expect(badge.textContent).toContain('Consultant ITSM Nuit')
    })

    it('rend les autres prestations non cliquables', async () => {
      const onApply = vi.fn(async () => true)
      renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: true, onApply })

      const badge = screen.getByTestId('autre-lB-2026-03-10')
      // Un élément non interactif ne peut pas devenir cliquable par accident.
      expect(badge.tagName).toBe('SPAN')
      fireEvent.click(badge)
      expect(onApply).not.toHaveBeenCalled()
    })

    it('laisse la prestation sélectionnée cliquable en mode « Tout le mois »', async () => {
      const onApply = vi.fn(async () => true)
      renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: true, onApply })

      fireEvent.click(caseDu('2026-03-11'))
      await waitFor(() => expect(onApply).toHaveBeenCalledWith('2026-03-11', { kind: 'JOURNEE' }))
    })

    it('n affiche pas d autre prestation les jours où elle n a rien saisi', () => {
      renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: true })
      expect(screen.queryByTestId('autre-lB-2026-03-11')).toBeNull()
    })

    it('donne à une prestation la même couleur entre deux chargements', () => {
      renderCalendar({ entries: surLigneB, autresLignes: [ligneB], toutLeMois: true })
      const premiere = screen.getByTestId('autre-lB-2026-03-10').className
      cleanup()

      // Second chargement : la liste des prestations a changé d'ordre et de taille.
      renderCalendar({
        entries: surLigneB,
        autresLignes: [{ ...ligneJour, id: 'lZ', label: 'Autre' }, ligneB],
        toutLeMois: true,
      })
      expect(screen.getByTestId('autre-lB-2026-03-10').className).toBe(premiere)
    })
  })

  describe('sélection par glissement', () => {
    function glisser(de: string, versLesDates: string[]): void {
      fireEvent.mouseDown(caseDu(de))
      for (const date of versLesDates) fireEvent.mouseEnter(caseDu(date))
      fireEvent.mouseUp(caseDu(versLesDates[versLesDates.length - 1] ?? de))
    }

    it('n affiche aucune barre tant qu un seul jour est sélectionné', () => {
      renderCalendar()
      glisser('2026-03-09', [])
      expect(screen.queryByTestId('barre-selection')).toBeNull()
    })

    it('propose d appliquer une valeur à toute la plage', () => {
      renderCalendar()
      glisser('2026-03-09', ['2026-03-10', '2026-03-11'])

      const barre = screen.getByTestId('barre-selection')
      expect(barre.textContent).toContain('3 jours')
      expect(screen.getByRole('button', { name: '1 jour' })).toBeDefined()
      expect(screen.getByRole('button', { name: '½ Matin' })).toBeDefined()
      expect(screen.getByRole('button', { name: '½ Après-midi' })).toBeDefined()
    })

    it('applique la valeur choisie à tous les jours de la plage', async () => {
      const onRange = vi.fn(async () => {})
      renderCalendar({ onRange })
      glisser('2026-03-09', ['2026-03-10', '2026-03-11'])

      fireEvent.click(screen.getByRole('button', { name: '1 jour' }))
      await waitFor(() =>
        expect(onRange).toHaveBeenCalledWith(
          ['2026-03-09', '2026-03-10', '2026-03-11'],
          { kind: 'JOURNEE' },
        ),
      )
    })

    it('vide toute la plage sur demande', async () => {
      const onRange = vi.fn(async () => {})
      renderCalendar({ onRange })
      glisser('2026-03-09', ['2026-03-10'])

      fireEvent.click(screen.getByRole('button', { name: 'Vider ces jours' }))
      await waitFor(() =>
        expect(onRange).toHaveBeenCalledWith(['2026-03-09', '2026-03-10'], { kind: 'VIDE' }),
      )
    })

    it('referme la barre sans rien appliquer sur Annuler', () => {
      const onRange = vi.fn(async () => {})
      renderCalendar({ onRange })
      glisser('2026-03-09', ['2026-03-10'])

      fireEvent.click(screen.getByRole('button', { name: 'Annuler la sélection' }))
      expect(screen.queryByTestId('barre-selection')).toBeNull()
      expect(onRange).not.toHaveBeenCalled()
    })

    it('n offre aucune demi-journée quand la prestation n en propose pas', () => {
      renderCalendar({ line: { ...ligneJour, allowedSlotIds: ['nuit'] } })
      glisser('2026-03-09', ['2026-03-10'])

      expect(screen.queryByRole('button', { name: '½ Matin' })).toBeNull()
      expect(screen.getByRole('button', { name: '1 jour' })).toBeDefined()
    })
  })
})
