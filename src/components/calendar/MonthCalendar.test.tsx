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

    // M4 : la même saisie s'affichait « 3h » ici et « 0,38 » dans le tableau.
    // L'unité d'une prestation est celle sous laquelle elle est vendue ; les
    // deux vues la suivent, elles ne se choisissent plus chacune la leur.
    it('affiche une valeur libre dans l unité de la prestation — en jours', () => {
      renderCalendar({ entries: [entree({ minutes: 180, slotId: 'nuit' })] })
      expect(valeurDu('2026-03-10').textContent).toBe('0,38')
    })

    it('affiche une valeur libre en heures sur une prestation vendue à l heure', () => {
      renderCalendar({
        line: ligneHeure,
        entries: [entree({ lineId: 'l2', minutes: 180, slotId: 'nuit' })],
      })
      expect(valeurDu('2026-03-10').textContent).toBe('3h')
    })

    // Le piège corrigé trois fois : convertir la SOMME des minutes sous le
    // facteur courant de la ligne donnerait « 1 » (480 min / 480), là où
    // chaque saisie convertie sous son propre facteur vaut 0,50 + 0,57.
    it('convertit chaque saisie sous le facteur figé à son écriture', () => {
      renderCalendar({
        entries: [
          entree({ id: 'a', minutes: 240, slotId: 'matin', minutesParJour: 480 }),
          entree({ id: 'b', minutes: 240, slotId: 'nuit', minutesParJour: 420 }),
        ],
      })
      expect(valeurDu('2026-03-10').textContent).toBe('1,07')
    })

    it('distingue le prévisionnel du réalisé', () => {
      renderCalendar({ entries: [entree({ kind: 'PREVISIONNEL' })] })
      expect(classes(caseDu('2026-03-10'))).toContain('italic')
    })

    // La règle vient de `kindDeLaJournee`, que le tableau consomme aussi :
    // écrite deux fois, elle divergerait, et le même jour se lirait réalisé
    // ici et prévisionnel là. Lire une journée mixte comme réalisée effacerait
    // de l'écran la seule trace de la conversion qui reste à faire.
    it('lit une journée mêlant réalisé et prévisionnel comme prévisionnelle', () => {
      renderCalendar({
        entries: [
          entree({ id: 'a', minutes: 240, slotId: 'matin', kind: 'REALISE' }),
          entree({ id: 'b', minutes: 240, slotId: 'apresmidi', kind: 'PREVISIONNEL' }),
        ],
      })
      expect(classes(caseDu('2026-03-10'))).toContain('italic')
    })

    it("ne dépend pas de l'ordre des saisies pour lire une journée mixte", () => {
      renderCalendar({
        entries: [
          entree({ id: 'a', minutes: 240, slotId: 'matin', kind: 'PREVISIONNEL' }),
          entree({ id: 'b', minutes: 240, slotId: 'apresmidi', kind: 'REALISE' }),
        ],
      })
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

    // I7 : le refus était couvert, le succès ne l'était pas. Après « Vider le
    // CRA » ou « Remplir le CRA », la case sur laquelle on venait de cliquer
    // gardait indéfiniment sa valeur optimiste, en contradiction avec la base.
    it('purge l affichage optimiste quand le serveur répond après un succès', async () => {
      const onApply = vi.fn(async () => true)
      const { rerender } = renderCalendar({
        onApply,
        entries: [entree({ minutes: 480, slotId: '' })],
      })
      expect(valeurDu('2026-03-10').textContent).toBe('1')

      // Le clic fait avancer la case d'un cran : « ½ M » s'affiche avant même
      // que le serveur ait répondu.
      fireEvent.click(caseDu('2026-03-10'))
      await waitFor(() => expect(valeurDu('2026-03-10').textContent).toBe('½ M'))
      await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))

      // Le mois est vidé ailleurs — la graine serveur change et ne porte plus
      // rien. L'optimiste doit disparaître avec elle.
      rerender(
        <MonthCalendar
          days={days}
          line={ligneJour}
          slots={DEFAULT_SLOTS}
          entries={[]}
          autresLignes={[]}
          toutLeMois={false}
          onApply={onApply}
          onRange={vi.fn(async () => {})}
          onFormulaire={vi.fn()}
        />,
      )
      expect(valeurDu('2026-03-10').textContent).toBe('')
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
    /**
     * Un glissement, quel que soit le doigt ou la souris qui le fait.
     *
     * En événements *pointer* et non *mouse* : `mouseenter` n'est pas émis
     * pendant qu'un doigt glisse, et la barre de sélection n'apparaissait
     * jamais sur un téléphone — où le tableau est masqué, donc où le
     * calendrier est la seule surface de saisie.
     */
    function glisserAvec(pointerType: string, de: string, versLesDates: string[]): void {
      fireEvent.pointerDown(caseDu(de), { pointerId: 1, pointerType, clientX: 10, clientY: 10 })
      for (const date of versLesDates) {
        fireEvent.pointerEnter(caseDu(date), { pointerId: 1, pointerType, clientX: 10, clientY: 10 })
      }
      fireEvent.pointerUp(caseDu(versLesDates[versLesDates.length - 1] ?? de), {
        pointerId: 1,
        pointerType,
        clientX: 10,
        clientY: 10,
      })
    }

    function glisser(de: string, versLesDates: string[]): void {
      glisserAvec('mouse', de, versLesDates)
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

    describe('au doigt', () => {
      it('sélectionne une plage au doigt, comme à la souris', async () => {
        const onRange = vi.fn(async () => {})
        renderCalendar({ onRange })
        glisserAvec('touch', '2026-03-09', ['2026-03-10', '2026-03-11'])

        expect(screen.getByTestId('barre-selection').textContent).toContain('3 jours')
        fireEvent.click(screen.getByRole('button', { name: '1 jour' }))
        await waitFor(() =>
          expect(onRange).toHaveBeenCalledWith(
            ['2026-03-09', '2026-03-10', '2026-03-11'],
            { kind: 'JOURNEE' },
          ),
        )
      })

      // Au doigt, la capture implicite du pointeur adresse le `pointerup` — et
      // le `click` qui le suit — à la case de départ : sans garde, un
      // glissement ferait avancer d'un cran la case où il a commencé.
      it('ne fait pas avancer d un cran la case où le glissement a commencé', async () => {
        const onApply = vi.fn(async () => true)
        renderCalendar({ onApply })
        glisserAvec('touch', '2026-03-09', ['2026-03-10', '2026-03-11'])
        fireEvent.click(caseDu('2026-03-09'))

        expect(onApply).not.toHaveBeenCalled()
        // La sélection, elle, survit au clic parasite.
        expect(screen.getByTestId('barre-selection').textContent).toContain('3 jours')
      })

      it('n ouvre pas le formulaire par appui long pendant un glissement', () => {
        vi.useFakeTimers()
        try {
          const onFormulaire = vi.fn()
          renderCalendar({ onFormulaire })

          fireEvent.pointerDown(caseDu('2026-03-09'), {
            pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10,
          })
          fireEvent.pointerEnter(caseDu('2026-03-10'), {
            pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 10,
          })
          fireEvent.pointerLeave(caseDu('2026-03-09'), {
            pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 10,
          })
          act(() => {
            vi.advanceTimersByTime(500)
          })

          expect(onFormulaire).not.toHaveBeenCalled()
        } finally {
          vi.useRealTimers()
        }
      })

      // Le doigt qui fait défiler la page ne quitte pas forcément la case, et
      // le navigateur n'émet pas toujours un `pointercancel` en prenant la
      // main : sans le seuil de glissement, le formulaire s'ouvrait au bout
      // d'une demi-seconde de défilement.
      it('n ouvre pas le formulaire quand le doigt défile sans quitter la case', () => {
        vi.useFakeTimers()
        try {
          const onFormulaire = vi.fn()
          renderCalendar({ onFormulaire })

          const c = caseDu('2026-03-09')
          fireEvent.pointerDown(c, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 })
          fireEvent.pointerMove(c, { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 58 })
          act(() => {
            vi.advanceTimersByTime(500)
          })

          expect(onFormulaire).not.toHaveBeenCalled()
        } finally {
          vi.useRealTimers()
        }
      })

      // Un défilement de la page annule le geste : le navigateur reprend la
      // main par un `pointercancel`, et il ne doit rien rester à l'écran.
      it('abandonne la sélection quand le navigateur reprend le geste', () => {
        renderCalendar()
        fireEvent.pointerDown(caseDu('2026-03-09'), {
          pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10,
        })
        fireEvent.pointerEnter(caseDu('2026-03-10'), {
          pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 60,
        })
        fireEvent.pointerCancel(caseDu('2026-03-09'), { pointerId: 1, pointerType: 'touch' })

        expect(screen.queryByTestId('barre-selection')).toBeNull()
      })

      // Un doigt n'a pas de touche Maj : une plage qui déborde de la semaine
      // se termine en touchant son dernier jour.
      it('étend une sélection posée en touchant un autre jour', async () => {
        const onApply = vi.fn(async () => true)
        const recues: string[][] = []
        const onRange = vi.fn(async (dates: string[]) => {
          recues.push(dates)
        })
        renderCalendar({ onApply, onRange })
        glisserAvec('touch', '2026-03-09', ['2026-03-10'])

        glisserAvec('touch', '2026-03-20', [])
        fireEvent.click(caseDu('2026-03-20'))

        expect(screen.getByTestId('barre-selection').textContent).toContain('12 jours')
        // Le jour touché étend la plage ; il ne fait pas avancer sa case.
        expect(onApply).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Vider ces jours' }))
        await waitFor(() => expect(recues).toHaveLength(1))
        expect(recues[0]).toHaveLength(12)
        expect(recues[0]![0]).toBe('2026-03-09')
        expect(recues[0]![11]).toBe('2026-03-20')
      })
    })

    describe('au clavier', () => {
      it('étend la sélection avec Maj et les flèches, et suit le focus', () => {
        renderCalendar()
        caseDu('2026-03-09').focus()

        fireEvent.keyDown(caseDu('2026-03-09'), { key: 'ArrowRight', shiftKey: true })
        expect(screen.getByTestId('barre-selection').textContent).toContain('2 jours')
        expect(document.activeElement).toBe(caseDu('2026-03-10'))

        // Une flèche verticale avance d'une semaine : c'est ce que la grille
        // montre, et la seule façon d'atteindre une plage de plusieurs semaines
        // sans trente frappes.
        fireEvent.keyDown(caseDu('2026-03-10'), { key: 'ArrowDown', shiftKey: true })
        expect(screen.getByTestId('barre-selection').textContent).toContain('9 jours')
        expect(document.activeElement).toBe(caseDu('2026-03-17'))
      })

      it('applique une valeur à la plage sélectionnée au clavier', async () => {
        const onRange = vi.fn(async () => {})
        renderCalendar({ onRange })

        fireEvent.keyDown(caseDu('2026-03-09'), { key: 'ArrowRight', shiftKey: true })
        fireEvent.keyDown(caseDu('2026-03-10'), { key: 'ArrowRight', shiftKey: true })
        fireEvent.click(screen.getByRole('button', { name: '1 jour' }))

        await waitFor(() =>
          expect(onRange).toHaveBeenCalledWith(
            ['2026-03-09', '2026-03-10', '2026-03-11'],
            { kind: 'JOURNEE' },
          ),
        )
      })

      // Le rang hors du mois ne se rabat sur rien : ni sur le dernier jour, ni
      // sur le premier. Une plage posée en bord de mois y reste telle quelle.
      it('ne déborde pas du mois, ni par la fin ni par le début', () => {
        renderCalendar()

        fireEvent.keyDown(caseDu('2026-03-30'), { key: 'ArrowRight', shiftKey: true })
        expect(screen.getByTestId('barre-selection').textContent).toContain('2 jours')
        fireEvent.keyDown(caseDu('2026-03-31'), { key: 'ArrowRight', shiftKey: true })
        expect(screen.getByTestId('barre-selection').textContent).toContain('2 jours')
        expect(document.activeElement).not.toBe(caseDu('2026-03-30'))

        fireEvent.click(screen.getByRole('button', { name: 'Annuler la sélection' }))
        fireEvent.keyDown(caseDu('2026-03-02'), { key: 'ArrowLeft', shiftKey: true })
        expect(screen.getByTestId('barre-selection').textContent).toContain('2 jours')
        fireEvent.keyDown(caseDu('2026-03-01'), { key: 'ArrowUp', shiftKey: true })
        expect(screen.getByTestId('barre-selection').textContent).toContain('2 jours')
      })

      it('abandonne la sélection sur Échap', () => {
        renderCalendar()
        fireEvent.keyDown(caseDu('2026-03-09'), { key: 'ArrowRight', shiftKey: true })
        expect(screen.getByTestId('barre-selection')).toBeDefined()

        fireEvent.keyDown(caseDu('2026-03-10'), { key: 'Escape' })
        expect(screen.queryByTestId('barre-selection')).toBeNull()
      })

      it('laisse Maj+Entrée ouvrir le formulaire, sans rien sélectionner', () => {
        const onFormulaire = vi.fn()
        renderCalendar({ onFormulaire })

        fireEvent.keyDown(caseDu('2026-03-11'), { key: 'Enter', shiftKey: true })

        expect(onFormulaire).toHaveBeenCalledWith('2026-03-11', { kind: 'VIDE' })
        expect(screen.queryByTestId('barre-selection')).toBeNull()
      })
    })

    // M1 : `onMouseUp` remettait `dragging` à faux sans effacer la sélection
    // d'un jour que `mousedown` venait de créer. La case gardait sa bague
    // `ring-focus` — la couleur du focus, posée sur un élément qui ne l'a pas.
    describe('un simple clic ne laisse rien derrière lui', () => {
      it('n entoure aucune case après un clic sans glissement', async () => {
        const onApply = vi.fn(async () => true)
        renderCalendar({ onApply })

        glisserAvec('mouse', '2026-03-10', [])
        fireEvent.click(caseDu('2026-03-10'))

        expect(classes(caseDu('2026-03-10'))).not.toContain('ring-focus')
        expect(screen.queryByTestId('barre-selection')).toBeNull()
        // Le cran, lui, a bien avancé : c'est un clic, pas un geste avalé.
        await waitFor(() => expect(onApply).toHaveBeenCalledWith('2026-03-10', { kind: 'JOURNEE' }))
      })

      it('garde la bague sur les jours réellement sélectionnés', () => {
        renderCalendar()
        glisser('2026-03-09', ['2026-03-10'])

        expect(classes(caseDu('2026-03-09'))).toContain('ring-focus')
        expect(classes(caseDu('2026-03-10'))).toContain('ring-focus')
        expect(classes(caseDu('2026-03-11'))).not.toContain('ring-focus')
      })
    })
  })
})

/**
 * Sous la largeur `md`, la vue tableau est masquée : le calendrier est alors la
 * seule surface de saisie. Un marquage d'occupation qui n'existerait que dans
 * le tableau n'existerait pas du tout pour un usage au téléphone.
 */
describe('MonthCalendar — occupation de l agenda', () => {
  afterEach(cleanup)

  it('marque la case d un jour occupé', () => {
    renderCalendar({ busyDates: ['2026-03-10'] })
    expect(caseDu('2026-03-10').getAttribute('data-busy')).toBe('true')
  })

  it('ne marque pas les autres jours', () => {
    renderCalendar({ busyDates: ['2026-03-10'] })
    expect(caseDu('2026-03-11').getAttribute('data-busy')).toBeNull()
  })

  it('ne marque rien quand l agenda est injoignable', () => {
    // Liste vide : ce que `getBusyDays` rend en cas de panne.
    renderCalendar({ busyDates: [] })
    expect(caseDu('2026-03-10').getAttribute('data-busy')).toBeNull()
  })

  it('dit l occupation dans le nom de la case, pas seulement par un signe', () => {
    renderCalendar({ busyDates: ['2026-03-10'] })
    expect(caseDu('2026-03-10').getAttribute('aria-label')).toContain(
      'Occupation dans votre agenda',
    )
    expect(caseDu('2026-03-11').getAttribute('aria-label')).not.toContain('Occupation')
  })

  it('n efface pas l état du jour qu il marque', () => {
    // 2026-03-02 est férié dans ce jeu d'essai.
    renderCalendar({ busyDates: ['2026-03-02'] })
    expect(classes(caseDu('2026-03-02'))).toContain('pattern-dots')
    expect(caseDu('2026-03-02').getAttribute('aria-label')).toContain('Jour férié')
    expect(caseDu('2026-03-02').getAttribute('aria-label')).toContain('Occupation dans votre agenda')
  })

  it('porte un marqueur visible qui ne dépend pas de la teinte', () => {
    renderCalendar({ busyDates: ['2026-03-10'] })
    const marqueur = screen.getByTestId('occupation-2026-03-10')
    // Un glyphe, comme les bandeaux : il se voit en vision monochrome.
    expect(marqueur.textContent).not.toBe('')
    // Et il est masqué aux lecteurs d'écran, qui lisent déjà le nom de la case.
    expect(marqueur.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByTestId('occupation-2026-03-11')).toBeNull()
  })

  it('laisse la case d un jour occupé pleinement cliquable', async () => {
    const onApply = vi.fn(async () => true)
    renderCalendar({ busyDates: ['2026-03-10'], onApply })

    expect(caseDu('2026-03-10').disabled).toBe(false)
    fireEvent.click(caseDu('2026-03-10'))

    // Marquer n'est pas bloquer : le cran avance comme sur un jour libre.
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('2026-03-10', { kind: 'JOURNEE' }))
    expect(valeurDu('2026-03-10').textContent).toBe('1')
  })

  it('ne trouble pas la valeur affichée par la case', () => {
    renderCalendar({ busyDates: ['2026-03-10'], entries: [entree({ minutes: 240, slotId: '' })] })
    // `toBe` et non `toContain` : le marqueur ne doit pas se glisser dans la
    // valeur, et « 0,5 » contient déjà « 0 » comme « 5 ».
    expect(valeurDu('2026-03-10').textContent).toBe('0,5')
  })
})
