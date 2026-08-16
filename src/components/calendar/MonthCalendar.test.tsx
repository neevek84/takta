// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, cleanup, fireEvent, act, waitFor } from '@testing-library/react'
import { MonthCalendar } from './MonthCalendar'
import { colorForLine } from '@/core/saisie/colors'
import { TEXT_PAIRS, THEME_TOKEN_KEYS, type ThemeTokens } from '@/core/theme/tokens'
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
    kind: 'REALISE', slotId: '', startMinute: 540, endMinute: 1020, minutesParJour: 480, ...over,
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
    // L'intitulé double la teinte : sans lui, la distinction disparaîtrait
    // pour qui ne perçoit pas la nuance de fond.
    renderCalendar()
    expect(caseDu('2026-03-01').getAttribute('aria-label')).toContain('Jour non ouvré')
    expect(caseDu('2026-03-02').getAttribute('aria-label')).toContain('Jour férié')
  })

  it('distingue le week-end par la clarté, sans motif', () => {
    // Le dithering était le signal d'ancienneté le plus fort du dessin, et il
    // couvrait huit jours par mois. L'écart de clarté entre `surface` et `off`
    // (100 contre 91,2 en L*) porte l'information, et `MIN_LIGHTNESS_GAP` le
    // vérifie déjà ; le nom accessible la porte pour qui ne voit ni l'un ni
    // l'autre.
    renderCalendar()
    expect(classes(caseDu('2026-03-01'))).toContain('bg-off')
    expect(classes(caseDu('2026-03-01'))).not.toContain('pattern-stripes')
    expect(classes(caseDu('2026-03-03'))).toContain('bg-surface')
  })

  it('garde le motif sur les fériés, qui sont rares', () => {
    // Dix jours par an, une information plus forte, un marqueur qui ne fatigue
    // personne : le férié garde le sien.
    renderCalendar()
    expect(classes(caseDu('2026-03-02'))).toContain('pattern-dots')
    expect(classes(caseDu('2026-03-02'))).toContain('bg-off-strong')
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
      renderCalendar({
        onApply,
        onFormulaire,
        // Bornes figées de la saisie : le formulaire les reçoit telles quelles,
        // il ne les reconstruit pas depuis les réglages.
        entries: [entree({ minutes: 180, slotId: '', startMinute: 540, endMinute: 720 })],
      })

      fireEvent.click(caseDu('2026-03-10'))

      await waitFor(() =>
        expect(onFormulaire).toHaveBeenCalledWith('2026-03-10', {
          kind: 'LIBRE', minutes: 180, slotId: '', startMinute: 540, endMinute: 720, eclatee: false,
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
      expect(valeurDu('2026-03-10').textContent).toBe('½ PM')
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
          entree({ id: 'a', minutes: 240, slotId: 'matin', startMinute: 540, endMinute: 1020, minutesParJour: 480 }),
          entree({ id: 'b', minutes: 240, slotId: 'nuit', startMinute: 540, endMinute: 1020, minutesParJour: 420 }),
        ],
      })
      expect(valeurDu('2026-03-10').textContent).toBe('1,07')
    })

    it('distingue le prévisionnel du réalisé', () => {
      renderCalendar({ entries: [entree({ kind: 'PREVISIONNEL' })] })
      expect(classes(caseDu('2026-03-10'))).toContain('italic')
      expect(screen.getByTestId('previsionnel-2026-03-10')).toBeDefined()
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
      await waitFor(() => expect(valeurDu('2026-03-10').textContent).toBe('½ AM'))
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
      expect(valeurDu('2026-03-10').textContent).toBe('½ AM')
    })
  })

  const ligneB: LineForGrid = {
    ...ligneJour,
    id: 'lB',
    label: 'Consultant ITSM Nuit',
    soldCentiemes: 1000,
  }

  const surLigneB: MonthEntry[] = [
    { id: 'b1', lineId: 'lB', date: '2026-03-10', minutes: 480, kind: 'REALISE', slotId: '', startMinute: 540, endMinute: 1020, minutesParJour: 480 },
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

    /**
     * Le libellé d'une autre prestation se pose **sous** sa case, dans sa
     * colonne. Tant que la colonne déclarait la même gouttière que la grille,
     * il se trouvait à égale distance de sa propre case et de la case de la
     * semaine suivante : il n'attachait à rien, et se lisait comme une barre
     * posée entre deux semaines — ce que le porteur a photographié.
     *
     * La correction se prend du côté de la colonne, jamais de la grille : la
     * gouttière de la grille est ce qui laisse aux sept colonnes leurs 44
     * points sur un écran de 375, et l'élargir les ferait tomber à 43,29.
     */
    it('attache le libellé à sa case plutôt qu à la semaine suivante', () => {
      const { container } = renderCalendar({
        entries: surLigneB,
        autresLignes: [ligneB],
        toutLeMois: true,
      })

      /** Pas d'espacement déclarés par une classe `gap-N` ; 0 si aucune. */
      function gouttiere(el: Element): number {
        const trouve = /(?:^|\s)gap-([\d.]+)(?:\s|$)/.exec(el.className)
        return trouve === null ? 0 : Number(trouve[1]!)
      }

      const badge = screen.getByTestId('autre-lB-2026-03-10')
      const colonne = badge.parentElement!
      const grille = container.querySelector('[data-testid="grille-calendrier"]')!

      // La colonne contient bien la case et son libellé.
      expect(colonne.contains(caseDu('2026-03-10'))).toBe(true)
      // Et la grille garde la sienne : c'est le budget des 44 points.
      expect(gouttiere(grille)).toBeGreaterThan(0)
      expect(gouttiere(colonne)).toBeLessThan(gouttiere(grille))
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
      expect(screen.getByRole('button', { name: '½ AM' })).toBeDefined()
      expect(screen.getByRole('button', { name: '½ PM' })).toBeDefined()
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

      expect(screen.queryByRole('button', { name: '½ AM' })).toBeNull()
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

      // Le dessin d'une case ajoute des nœuds *dans* le bouton. Les gestes se
      // testaient chacun isolément ; ce sont leurs enchaînements qui cassent.
      describe('les gestes s enchaînent sans se marcher dessus', () => {
        it('un appui long après un glissement ouvre le formulaire sans appliquer la plage', () => {
          vi.useFakeTimers()
          try {
            const onApply = vi.fn(async () => true)
            const onRange = vi.fn(async () => {})
            const onFormulaire = vi.fn()
            renderCalendar({ onApply, onRange, onFormulaire })

            glisserAvec('touch', '2026-03-09', ['2026-03-10'])
            const c = caseDu('2026-03-16')
            fireEvent.pointerDown(c, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 10 })
            act(() => {
              vi.advanceTimersByTime(500)
            })
            fireEvent.pointerUp(c, { pointerId: 2, pointerType: 'touch', clientX: 10, clientY: 10 })
            fireEvent.click(c)

            expect(onFormulaire).toHaveBeenCalledWith('2026-03-16', { kind: 'VIDE' })
            expect(onApply).not.toHaveBeenCalled()
            expect(onRange).not.toHaveBeenCalled()
          } finally {
            vi.useRealTimers()
          }
        })

        it('un clic droit pendant un glissement ouvre le formulaire sans faire avancer la case', () => {
          const onApply = vi.fn(async () => true)
          const onFormulaire = vi.fn()
          renderCalendar({ onApply, onFormulaire })

          fireEvent.pointerDown(caseDu('2026-03-09'), {
            pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 10,
          })
          fireEvent.pointerEnter(caseDu('2026-03-10'), {
            pointerId: 1, pointerType: 'mouse', clientX: 40, clientY: 10,
          })
          fireEvent.contextMenu(caseDu('2026-03-10'))

          expect(onFormulaire).toHaveBeenCalledWith('2026-03-10', { kind: 'VIDE' })
          expect(onApply).not.toHaveBeenCalled()
        })

        // Le geste part d'une case remplie : l'aplat est un nœud de plus sous
        // le pointeur, et il ne doit rien intercepter.
        it('glisse depuis une case remplie comme depuis une case vide', async () => {
          const onRange = vi.fn(async () => {})
          renderCalendar({ onRange, entries: [entree({ minutes: 240, slotId: 'matin' })] })

          glisserAvec('touch', '2026-03-10', ['2026-03-11'])
          expect(screen.getByTestId('barre-selection').textContent).toContain('2 jours')

          fireEvent.click(screen.getByRole('button', { name: '½ PM' }))
          await waitFor(() =>
            expect(onRange).toHaveBeenCalledWith(
              ['2026-03-10', '2026-03-11'],
              { kind: 'DEMI', slotId: 'apres-midi' },
            ),
          )
        })

        it('Maj+Entrée sur une case sélectionnée ouvre le formulaire et garde la plage', () => {
          const onFormulaire = vi.fn()
          renderCalendar({ onFormulaire })

          fireEvent.keyDown(caseDu('2026-03-09'), { key: 'ArrowRight', shiftKey: true })
          fireEvent.keyDown(caseDu('2026-03-10'), { key: 'Enter', shiftKey: true })

          expect(onFormulaire).toHaveBeenCalledWith('2026-03-10', { kind: 'VIDE' })
          expect(screen.getByTestId('barre-selection').textContent).toContain('2 jours')
        })
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
 * Le cœur du lot 1f : la quantité se lit à la forme, pas au chiffre.
 *
 * Le remplissage est un nœud à part (`remplissage-<date>`), sous le contenu :
 * c'est lui qui porte l'aplat, et le chiffre reste par-dessus, jamais à sa
 * place — une durée libre de trois heures ne se déduit d'aucun aplat.
 */
describe('MonthCalendar — le dessin d une case', () => {
  afterEach(cleanup)

  function remplissageDu(date: string): HTMLElement {
    return screen.getByTestId(`remplissage-${date}`)
  }

  it('ne dessine rien sur une case vide', () => {
    renderCalendar()
    expect(screen.queryByTestId('remplissage-2026-03-10')).toBeNull()
  })

  it('remplit toute la case pour une journée entière', () => {
    renderCalendar({ entries: [entree({ minutes: 480, slotId: '' })] })
    const aplat = remplissageDu('2026-03-10')
    expect(aplat.getAttribute('data-forme')).toBe('PLEINE')
    expect(aplat.style.height).toBe('100%')
  })

  // La convention retenue par le porteur : le matin en haut à gauche,
  // l'après-midi en bas à droite, séparés par une diagonale montant de
  // bas-gauche à haut-droite. Les deux moitiés sont **spatialement**
  // distinctes, ce qui se lit sans l'apprendre.
  it('pose la demi-journée du matin sur la moitié haute-gauche', () => {
    renderCalendar({ entries: [entree({ minutes: 240, slotId: 'matin' })] })
    const aplat = remplissageDu('2026-03-10')
    expect(aplat.getAttribute('data-forme')).toBe('MOITIE-AM')
    expect(classes(aplat)).toContain('clip-half-am')
    expect(classes(aplat)).not.toContain('clip-half-pm')
  })

  it('pose la demi-journée de l après-midi sur la moitié basse-droite', () => {
    renderCalendar({ entries: [entree({ minutes: 240, slotId: 'apres-midi' })] })
    const aplat = remplissageDu('2026-03-10')
    expect(aplat.getAttribute('data-forme')).toBe('MOITIE-PM')
    expect(classes(aplat)).toContain('clip-half-pm')
    expect(classes(aplat)).not.toContain('clip-half-am')
  })

  it('remplit une durée libre proportionnellement, et garde le chiffre', () => {
    // 3 h sur une journée de 8 h : 0,38 j, et 38 % de la case.
    renderCalendar({ entries: [entree({ minutes: 180, slotId: 'nuit' })] })
    const aplat = remplissageDu('2026-03-10')
    expect(aplat.getAttribute('data-forme')).toBe('PARTIELLE')
    expect(aplat.style.height).toBe('38%')
    // Le chiffre reste : aucun aplat ne dit « trois heures ».
    expect(valeurDu('2026-03-10').textContent).toBe('0,38')
  })

  // Le piège le plus répété du projet, ici sur une hauteur d'aplat : convertir
  // la somme des minutes sous le facteur courant donnerait 480/480 = 100 %.
  it('calcule la hauteur de l aplat à facteur constant', () => {
    renderCalendar({
      entries: [
        entree({ id: 'a', minutes: 240, slotId: 'matin', startMinute: 540, endMinute: 1020, minutesParJour: 480 }),
        entree({ id: 'b', minutes: 120, slotId: 'nuit', startMinute: 540, endMinute: 1020, minutesParJour: 420 }),
      ],
    })
    // 0,50 + 0,29 = 0,79 — et non 360/480 = 0,75.
    expect(remplissageDu('2026-03-10').style.height).toBe('79%')
  })

  // `0,29 * 100` vaut `28.999999999999996` en virgule flottante : la hauteur
  // partait dans le style de la case telle quelle. Huit des cent proportions
  // possibles en souffraient — 7, 14, 28, 29, 55, 56, 57 et 58 centièmes.
  it('rend une hauteur exacte, sans bruit de virgule flottante', () => {
    // 2 h sur une journée de 7 h : 29 centièmes de journée.
    renderCalendar({
      entries: [entree({ minutes: 120, slotId: 'nuit', startMinute: 540, endMinute: 1020, minutesParJour: 420 })],
    })
    expect(remplissageDu('2026-03-10').style.height).toBe('29%')
  })

  it('pose l aplat sous le contenu, sans intercepter le geste', () => {
    renderCalendar({ entries: [entree({ minutes: 480, slotId: '' })] })
    const aplat = remplissageDu('2026-03-10')
    expect(aplat.getAttribute('aria-hidden')).toBe('true')
    expect(classes(aplat)).toContain('pointer-events-none')
    // Le chiffre est bien dans la case, pas dans l'aplat.
    expect(aplat.contains(valeurDu('2026-03-10'))).toBe(false)
  })

  // L'angle mort signalé par la tâche des thèmes : le contrôle de contraste
  // porte sur des couleurs opaques. Une demi-couverture obtenue par une
  // opacité (`bg-accent/45`) y échapperait — l'aplat n'utilise donc que des
  // jetons pleins, et la moitié se taille au `clip-path`.
  it('n obtient jamais sa moitié par une opacité', () => {
    renderCalendar({ entries: [entree({ minutes: 240, slotId: 'matin' })] })
    for (const c of classes(remplissageDu('2026-03-10'))) {
      expect(c).not.toMatch(/^(?:bg|text|border|ring)-.*\/\d+$/)
    }
    expect(remplissageDu('2026-03-10').style.opacity).toBe('')
  })

  // Le nom de la classe ne dit pas ce qu'elle taille : sans ce contrôle, une
  // découpe qui rendrait la case pleine passerait tous les tests ci-dessus.
  // C'est ici que vit la convention du porteur — une diagonale montant de
  // bas-gauche à haut-droite, le matin au-dessus, l'après-midi en dessous.
  it('taille deux moitiés complémentaires le long de la même diagonale', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')

    function sommets(utilitaire: string): string[] {
      const bloc = new RegExp(`@utility\\s+${utilitaire}\\s*\\{([^}]*)\\}`).exec(css)
      expect(bloc, `@utility ${utilitaire} introuvable`).not.toBeNull()
      const polygone = /clip-path:\s*polygon\(([^)]*)\)/.exec(bloc![1]!)
      expect(polygone, `${utilitaire} ne taille aucun polygone`).not.toBeNull()
      return polygone![1]!.split(',').map((p) => p.trim().replace(/\s+/g, ' '))
    }

    const am = sommets('clip-half-am')
    const pm = sommets('clip-half-pm')

    // Trois sommets : un triangle, donc une moitié — quatre en feraient une
    // case pleine, et les deux moitiés redeviendraient identiques.
    expect(am).toHaveLength(3)
    expect(pm).toHaveLength(3)

    // Les deux extrémités de la diagonale appartiennent aux deux moitiés.
    for (const moitie of [am, pm]) {
      expect(moitie).toContain('0 100%')
      expect(moitie).toContain('100% 0')
    }

    // Et chacune ne garde que son propre coin : le matin en haut à gauche,
    // l'après-midi en bas à droite.
    expect(am).toContain('0 0')
    expect(am).not.toContain('100% 100%')
    expect(pm).toContain('100% 100%')
    expect(pm).not.toContain('0 0')
  })

  it('aucune information portée par la seule couleur : chaque état a sa forme', () => {
    // Les cinq états, rendus l'un après l'autre, réduits à ce qui se voit en
    // vision monochrome : la forme et sa hauteur. Deux états qui partageraient
    // cette signature seraient indistinguables sans la teinte.
    const cas: Array<[string, MonthEntry[]]> = [
      ['vide', []],
      ['journée', [entree({ minutes: 480, slotId: '' })]],
      ['matin', [entree({ minutes: 240, slotId: 'matin' })]],
      ['après-midi', [entree({ minutes: 240, slotId: 'apres-midi' })]],
      ['libre', [entree({ minutes: 180, slotId: 'nuit' })]],
    ]

    const signatures = cas.map(([, entries]) => {
      cleanup()
      renderCalendar({ entries })
      const aplat = screen.queryByTestId('remplissage-2026-03-10')
      return aplat === null ? 'AUCUNE' : `${aplat.getAttribute('data-forme')}|${aplat.style.height}`
    })

    expect(new Set(signatures).size).toBe(cas.length)
  })
})

describe('MonthCalendar — le prévisionnel', () => {
  afterEach(cleanup)

  // Les hachures étaient illisibles — constaté à l'usage, pas supposé.
  it('n emploie plus de hachures', () => {
    renderCalendar({ entries: [entree({ kind: 'PREVISIONNEL' })] })
    expect(classes(caseDu('2026-03-10'))).not.toContain('pattern-hatch')
  })

  /**
   * La forme ne faiblit pas, la teinte change.
   *
   * Le lot 1f donnait au prévisionnel le remplissage exact du réalisé, teinte
   * comprise : il ne s'en distinguait que par l'horloge. Le passé est froid,
   * le futur est chaud — le prévisionnel porte désormais sa propre teinte,
   * mais il garde la même forme et la même hauteur, parce qu'un demi-jour
   * prévu n'est pas moins qu'un demi-jour réalisé.
   */
  it('garde la forme et la hauteur du réalisé, mais pas sa teinte', () => {
    renderCalendar({ entries: [entree({ minutes: 240, slotId: 'matin', kind: 'REALISE' })] })
    const realise = screen.getByTestId('remplissage-2026-03-10')
    const forme = `${realise.getAttribute('data-forme')}|${realise.style.height}`
    const teinteRealisee = classes(realise).find((c) => c.startsWith('bg-'))
    cleanup()

    renderCalendar({ entries: [entree({ minutes: 240, slotId: 'matin', kind: 'PREVISIONNEL' })] })
    const previsionnel = screen.getByTestId('remplissage-2026-03-10')
    expect(`${previsionnel.getAttribute('data-forme')}|${previsionnel.style.height}`).toBe(forme)
    expect(classes(previsionnel)).toContain('bg-prevu')
    expect(teinteRealisee).not.toBe('bg-prevu')
  })

  it('dessine une case prévisionnelle en ambre et en tireté', () => {
    // La teinte dit l'état, le tireté le dit aussi sans elle : deux aplats
    // opaques ne se distingueraient pas en vision monochrome.
    renderCalendar({ entries: [entree({ kind: 'PREVISIONNEL' })] })
    expect(classes(screen.getByTestId('remplissage-2026-03-10'))).toContain('bg-prevu')
    expect(classes(caseDu('2026-03-10'))).toContain('border-dashed')
  })

  it('laisse la case réalisée en plein trait et sans ambre', () => {
    renderCalendar({ entries: [entree({ kind: 'REALISE' })] })
    expect(classes(screen.getByTestId('remplissage-2026-03-10'))).not.toContain('bg-prevu')
    expect(classes(caseDu('2026-03-10'))).not.toContain('border-dashed')
  })

  it('porte une icône d horloge, visible en monochrome', () => {
    renderCalendar({ entries: [entree({ kind: 'PREVISIONNEL' })] })
    const horloge = screen.getByTestId('previsionnel-2026-03-10')
    // Un tracé, pas une teinte : il se voit quelle que soit la palette.
    expect(horloge.tagName.toLowerCase()).toBe('svg')
    expect(horloge.getAttribute('aria-hidden')).toBe('true')
    expect(horloge.querySelectorAll('circle, path, line').length).toBeGreaterThan(0)
  })

  it('n en pose aucune sur une journée réalisée', () => {
    renderCalendar({ entries: [entree({ kind: 'REALISE' })] })
    expect(screen.queryByTestId('previsionnel-2026-03-10')).toBeNull()
  })

  // L'icône se voit ; le nom accessible doit le dire aussi.
  it('nomme le prévisionnel dans le nom accessible de la case', () => {
    renderCalendar({ entries: [entree({ kind: 'PREVISIONNEL' })] })
    expect(caseDu('2026-03-10').getAttribute('aria-label')).toContain('Prévisionnel')
    cleanup()
    renderCalendar({ entries: [entree({ kind: 'REALISE' })] })
    expect(caseDu('2026-03-10').getAttribute('aria-label')).not.toContain('Prévisionnel')
  })
})

describe('MonthCalendar — le jour courant', () => {
  afterEach(cleanup)

  // La frontière entre réalisé et prévisionnel passe exactement là, et rien ne
  // la montrait.
  it('distingue la case du jour de toutes les autres, quel que soit son contenu', () => {
    for (const entries of [[], [entree({ minutes: 480, slotId: '' })]]) {
      cleanup()
      renderCalendar({ entries, aujourdhui: '2026-03-10' })
      expect(caseDu('2026-03-10').getAttribute('data-aujourdhui')).toBe('true')
      // Une bordure épaisse, pas seulement une teinte.
      expect(classes(caseDu('2026-03-10'))).toContain('border-2')
      expect(classes(caseDu('2026-03-11'))).not.toContain('border-2')
      expect(caseDu('2026-03-11').getAttribute('data-aujourdhui')).toBeNull()
    }
  })

  it('le dit en toutes lettres, pas seulement par un trait', () => {
    renderCalendar({ aujourdhui: '2026-03-10' })
    expect(caseDu('2026-03-10').getAttribute('aria-label')).toContain('Aujourd’hui')
    expect(caseDu('2026-03-11').getAttribute('aria-label')).not.toContain('Aujourd’hui')
  })

  it('ne marque aucune case quand le jour courant est hors du mois affiché', () => {
    renderCalendar({ aujourdhui: '2026-04-02' })
    expect(screen.queryByTestId('case-2026-03-10')!.getAttribute('data-aujourdhui')).toBeNull()
  })

  it('laisse la case du jour pleinement cliquable', async () => {
    const onApply = vi.fn(async () => true)
    renderCalendar({ aujourdhui: '2026-03-10', onApply })
    fireEvent.click(caseDu('2026-03-10'))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith('2026-03-10', { kind: 'JOURNEE' }))
  })
})

describe('MonthCalendar — la légende', () => {
  afterEach(cleanup)

  it('nomme les formes que la grille emploie', () => {
    renderCalendar()
    const legende = screen.getByTestId('legende-calendrier')
    for (const mot of ['1 j', '½ AM', '½ PM', 'Prévisionnel', 'Aujourd’hui']) {
      expect(legende.textContent).toContain(mot)
    }
  })

  it('montre la diagonale des deux côtés', () => {
    renderCalendar()
    const legende = screen.getByTestId('legende-calendrier')
    expect(legende.querySelector('.clip-half-am')).not.toBeNull()
    expect(legende.querySelector('.clip-half-pm')).not.toBeNull()
  })

  it('montre la teinte du prévisionnel, pas seulement son nom', () => {
    // Une légende qui nomme un état sans le donner à voir ne sert à rien : la
    // pastille porte la teinte ambre et le tireté que la case emploie.
    renderCalendar()
    const legende = screen.getByTestId('legende-calendrier')
    const pastille = legende.querySelector('.bg-prevu')
    expect(pastille).not.toBeNull()
    expect(classes(pastille!.parentElement!)).toContain('border-dashed')
  })

  it('garde les fonds de week-end et de férié qu elle portait déjà', () => {
    renderCalendar()
    const legende = screen.getByTestId('legende-calendrier')
    expect(legende.textContent).toContain('Jour non ouvré')
    expect(legende.textContent).toContain('Jour férié')
  })
})

describe('MonthCalendar — les mots', () => {
  afterEach(cleanup)

  it('dit ½ AM et ½ PM dans l infobulle, avec le libellé réglé en administration', () => {
    renderCalendar({ entries: [entree({ minutes: 240, slotId: 'matin' })] })
    expect(caseDu('2026-03-10').title).toContain('½ AM')
    expect(caseDu('2026-03-10').title).toContain('Matin')
  })

  it('garde le libellé réglé pour un créneau sans moitié de journée', () => {
    // « Nuit » franchit minuit : ni AM ni PM, et le dire serait faux.
    renderCalendar({ entries: [entree({ minutes: 240, slotId: 'nuit' })] })
    expect(caseDu('2026-03-10').title).toContain('Nuit')
    expect(caseDu('2026-03-10').title).not.toContain('½ PM')
  })
})

/**
 * La contrainte que le porteur a acceptée en connaissance de cause : l'icône
 * d'horloge encombre une case déjà petite sur téléphone. Ce test dit si elle
 * tient, et il échoue si elle ne tient pas.
 *
 * happy-dom ne calcule aucune mise en page : le budget est donc arithmétique,
 * mais ses termes sont lus là où ils sont réellement déclarés — la feuille de
 * jetons pour la cible tactile et les corps de texte, la page pour ses marges,
 * la grille rendue pour sa gouttière, l'icône rendue pour sa taille. Aucun
 * n'est recopié à la main ; les changer fait bouger le résultat.
 */
describe('MonthCalendar — l icône tient-elle à 375 points', () => {
  afterEach(cleanup)

  const CSS = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')
  /**
   * La marge de la page de saisie, telle que le gabarit commun la déclare.
   *
   * Elle vivait dans `page.tsx` tant que cet écran portait son propre
   * `<main>` ; depuis le lot 1g, tous les écrans passent par `PageShell`, et
   * c'est lui qui fait foi. Lire ailleurs mesurerait un budget que personne
   * n'applique — et lire un fichier qui n'a plus de `<main className="p-N">`
   * ferait lever ce test sur un `null`, avec un message qui ne dirait rien de
   * la cause.
   */
  const SHELL = readFileSync(
    join(process.cwd(), 'src', 'components', 'ui', 'PageShell.tsx'),
    'utf8',
  )

  /** Un écran de 375 points : l'iPhone le plus étroit encore en service. */
  const ECRAN = 375

  function rem(valeur: string): number {
    return Number(valeur) * 16
  }

  function jetonRem(nom: string): number {
    const trouve = new RegExp(`${nom}:\\s*([\\d.]+)rem`).exec(CSS)
    expect(trouve, `${nom} introuvable dans globals.css`).not.toBeNull()
    return rem(trouve![1]!)
  }

  const bloc = /@utility\s+touch-target\s*\{([^}]*)\}/.exec(CSS)
  const CIBLE = rem(/min-width:\s*([\d.]+)rem/.exec(bloc![1]!)![1]!)
  const TEXT_XS = jetonRem('--text-xs')
  const TEXT_SM = jetonRem('--text-sm')
  const PAS = jetonRem('--spacing')

  const marge = /<main className="[^"]*\bp-(\d+)\b/.exec(SHELL)
  expect(marge, 'PageShell ne déclare plus de marge `p-N` sur son <main>').not.toBeNull()
  const MARGE = Number(marge![1]!) * PAS

  /** Nombre de pas d'espacement d'une classe `gap-N` ou `gap-x-N`. */
  function gap(el: Element): number {
    const trouve = /(?:^|\s)gap-(?:x-)?([\d.]+)(?:\s|$)/.exec(el.className)
    expect(trouve, `aucune gouttière déclarée sur ${el.className}`).not.toBeNull()
    return Number(trouve![1]!) * PAS
  }

  /**
   * Avance horizontale d'un caractère, en fraction du corps. Volontairement
   * pessimiste : les chiffres d'Inter avancent de 0,60 em, ses capitales de
   * 0,72 em au plus. Sous-estimer ferait passer un test qui doit refuser.
   */
  const AVANCE = 0.75

  function largeurTexte(texte: string, corps: number): number {
    return texte.length * AVANCE * corps
  }

  it('laisse à chaque case ses 44 points sur un écran de 375', () => {
    const { container } = renderCalendar()
    const grille = container.querySelector('[data-testid="grille-calendrier"]')!
    const colonne = (ECRAN - 2 * MARGE - 6 * gap(grille)) / 7

    expect(colonne).toBeGreaterThanOrEqual(CIBLE)
  })

  it('loge le numéro du jour, le marqueur d occupation et l horloge sur la même ligne', () => {
    const { container } = renderCalendar({
      entries: [entree({ kind: 'PREVISIONNEL' })],
      busyDates: ['2026-03-10'],
      aujourdhui: '2026-03-10',
    })
    const grille = container.querySelector('[data-testid="grille-calendrier"]')!
    const colonne = (ECRAN - 2 * MARGE - 6 * gap(grille)) / 7

    const horloge = screen.getByTestId('previsionnel-2026-03-10')
    const largeurHorloge = Number(horloge.getAttribute('width'))
    expect(largeurHorloge).toBeGreaterThan(0)

    const ligne = horloge.parentElement!
    // Le marqueur d'occupation est un tracé, plus un caractère : sa largeur se
    // lit sur l'attribut, comme celle de l'horloge. La mesurer par son
    // `textContent` rendrait zéro et le budget cesserait de compter un terme.
    const occupation = screen.getByTestId('occupation-2026-03-10')
    const largeurOccupation = Number(occupation.getAttribute('width'))
    expect(largeurOccupation).toBeGreaterThan(0)

    const requis =
      largeurTexte('31', TEXT_XS) + largeurOccupation + largeurHorloge + 2 * gap(ligne)

    expect(requis).toBeLessThanOrEqual(colonne)
  })

  it('loge la valeur la plus large qu une case puisse afficher', () => {
    const { container } = renderCalendar({ entries: [entree({ minutes: 240, slotId: 'matin' })] })
    const grille = container.querySelector('[data-testid="grille-calendrier"]')!
    const colonne = (ECRAN - 2 * MARGE - 6 * gap(grille)) / 7

    // « ½ AM » et « ½ PM » sont les plus longues des valeurs courtes ; une
    // durée libre s'écrit « 0,38 », soit un caractère de moins.
    expect(valeurDu('2026-03-10').textContent).toBe('½ AM')
    expect(largeurTexte('½ AM', TEXT_SM)).toBeLessThanOrEqual(colonne)
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
    // Un tracé, comme les bandeaux : il se voit en vision monochrome. Lire le
    // `textContent` d'un `svg` rendrait la chaîne vide et ne prouverait rien.
    expect(marqueur.tagName.toLowerCase()).toBe('svg')
    expect(marqueur.querySelectorAll('circle, path, line, polyline').length).toBeGreaterThan(0)
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

/**
 * La teinte de l'aplat de la prestation saisie.
 *
 * Une couleur catégorielle ne distingue rien quand une seule catégorie est à
 * l'écran : le calendrier appelait pourtant `colorForLine(line.id)` sans
 * condition, et la prestation ouverte recevait une teinte tirée au hachage.
 */
describe('MonthCalendar — la teinte de l aplat suit la portée affichée', () => {
  afterEach(cleanup)

  /** La classe de fond de l'aplat, isolée des autres. */
  function fondDeLAplat(date: string): string | undefined {
    return classes(screen.getByTestId(`remplissage-${date}`)).find((c) => c.startsWith('bg-'))
  }

  const journee = [entree({ minutes: 480, slotId: '' })]

  it('signale « saisi » avec l aplat de saisie quand une seule prestation est affichée', () => {
    renderCalendar({ entries: journee, toutLeMois: false })
    expect(fondDeLAplat('2026-03-10')).toBe('bg-saisie')
  })

  it('ne tire aucune teinte au hachage en mode « Cette prestation »', () => {
    // Deux prestations différentes, ouvertes l'une après l'autre : la teinte
    // ne bouge pas, parce qu'elle ne dit rien de la prestation.
    renderCalendar({ entries: journee, toutLeMois: false })
    const premiere = fondDeLAplat('2026-03-10')
    cleanup()

    renderCalendar({
      line: { ...ligneJour, id: 'lX' },
      entries: journee.map((e) => ({ ...e, lineId: 'lX' })),
      toutLeMois: false,
    })
    expect(fondDeLAplat('2026-03-10')).toBe(premiere)
  })

  it('rend la teinte catégorielle en mode « Toutes les prestations »', () => {
    // Là, et seulement là, la teinte porte une information : c'est ce qui
    // distingue cette prestation des autres affichées à côté d'elle.
    renderCalendar({ entries: journee, toutLeMois: true })
    expect(fondDeLAplat('2026-03-10')).toBe(colorForLine(ligneJour.id).bg)
    expect(fondDeLAplat('2026-03-10')).not.toBe('bg-saisie')
  })

  /**
   * Le couple réellement peint, lu sur le DOM et non déduit.
   *
   * Le chiffre du jour et la valeur sont écrits sur le `<button>`, l'aplat est
   * un nœud posé dessous : le balayage de `tokens.test.ts` ne rapproche jamais
   * ces deux `className`, et le contrôle de contraste ne voyait donc ni
   * `ink`/`accent` ni `ink`/`prevu`. Ce test-ci les rapproche à la source, en
   * lisant les classes que le composant vient d'écrire.
   */
  describe('le couple encre du chiffre / teinte de l aplat entre dans le contrôle', () => {
    /** L'encre posée sur la case elle-même, isolée des autres classes. */
    function encreDeLaCase(date: string): string | undefined {
      return classes(caseDu(date)).find((c) => c.startsWith('text-') && c !== 'text-sm')
    }

    const JETON_PAR_CLASSE = new Map<string, keyof ThemeTokens>(
      THEME_TOKEN_KEYS.flatMap((k) => {
        const classe = k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
        return [
          [`bg-${classe}`, k],
          [`text-${classe}`, k],
        ] as [string, keyof ThemeTokens][]
      }),
    )

    function coupleRendu(date: string): { text: keyof ThemeTokens; background: keyof ThemeTokens } {
      const encre = encreDeLaCase(date)
      const fond = fondDeLAplat(date)
      expect(encre, `aucune encre sur la case ${date}`).toBeDefined()
      expect(fond, `aucun aplat sur la case ${date}`).toBeDefined()
      const text = JETON_PAR_CLASSE.get(encre!)
      const background = JETON_PAR_CLASSE.get(fond!)
      expect(text, `${encre} n’est pas un jeton du thème`).toBeDefined()
      expect(background, `${fond} n’est pas un jeton du thème`).toBeDefined()
      return { text: text!, background: background! }
    }

    it('en portée « Cette prestation », qui est la portée par défaut', () => {
      renderCalendar({ entries: journee, toutLeMois: false })
      expect(TEXT_PAIRS).toContainEqual(coupleRendu('2026-03-10'))
    })

    it('en portée « Toutes les prestations »', () => {
      renderCalendar({ entries: journee, toutLeMois: true })
      expect(TEXT_PAIRS).toContainEqual(coupleRendu('2026-03-10'))
    })

    it('sur une case prévisionnelle, qui prend sa propre teinte', () => {
      renderCalendar({
        entries: [entree({ minutes: 480, slotId: '', kind: 'PREVISIONNEL' })],
        toutLeMois: false,
      })
      expect(TEXT_PAIRS).toContainEqual(coupleRendu('2026-03-10'))
    })
  })

  it('garde à chaque autre prestation sa propre teinte catégorielle', () => {
    // Les libellés des autres prestations ne changent pas de règle : eux ne
    // sont rendus qu'en mode « Toutes les prestations ».
    const ligneB: LineForGrid = { ...ligneJour, id: 'lB', label: 'Astreinte' }
    renderCalendar({
      entries: [...journee, entree({ id: 'eB', lineId: 'lB' })],
      autresLignes: [ligneB],
      toutLeMois: true,
    })
    expect(classes(screen.getByTestId('autre-lB-2026-03-10'))).toContain(colorForLine('lB').bg)
  })
})

/**
 * La plage, pas la case.
 *
 * Des jours contigus au même état sont un seul fait : un consultant ne pense
 * pas « lundi, mardi, mercredi » mais « j'étais chez eux toute la semaine ».
 *
 * Toute la difficulté est que la fusion ne doit **rien** coûter en largeur :
 * à 375 points, la colonne vaut 45,0 pour une cible de 44 — un seul point de
 * marge. Elle se dessine donc par des bordures rendues transparentes, qui
 * occupent toujours leur largeur, et par un aplat en absolu qui déborde la
 * gouttière sans peser sur la boîte.
 */
describe('MonthCalendar — la plage plutôt que la case', () => {
  afterEach(cleanup)

  const journeeLe = (date: string, id: string) => entree({ id, date, minutes: 480, slotId: '' })

  function positionDe(date: string): string | null {
    return caseDu(date).getAttribute('data-plage')
  }

  it('rend les cases carrées', () => {
    renderCalendar()
    expect(classes(caseDu('2026-03-10'))).toContain('aspect-square')
  })

  it('aligne les chiffres d une case sur l autre', () => {
    // Trente-et-une cases en colonnes : sans chasse fixe, le numéro du jour et
    // la valeur dansent d'une ligne à l'autre. C'est la correction
    // typographique la moins chère et la plus visible du lot.
    renderCalendar()
    expect(classes(caseDu('2026-03-10'))).toContain('tabular-nums')
  })

  it('fusionne trois jours pleins contigus', () => {
    // 9, 10 et 11 mars 2026 : lundi, mardi, mercredi, dans la même ligne.
    renderCalendar({
      entries: [journeeLe('2026-03-09', 'a'), journeeLe('2026-03-10', 'b'), journeeLe('2026-03-11', 'c')],
    })
    expect(positionDe('2026-03-09')).toBe('DEBUT')
    expect(positionDe('2026-03-10')).toBe('MILIEU')
    expect(positionDe('2026-03-11')).toBe('FIN')
  })

  it('rompt la plage sur une demi-journée', () => {
    // Ce jour-là n'est pas le même fait que les autres : il garde ses quatre
    // filets, son rayon et ses marges.
    renderCalendar({
      entries: [
        journeeLe('2026-03-09', 'a'),
        entree({ id: 'b', date: '2026-03-10', minutes: 240, slotId: 'matin' }),
        journeeLe('2026-03-11', 'c'),
      ],
    })
    expect(positionDe('2026-03-09')).toBe('SEULE')
    expect(positionDe('2026-03-10')).toBe('SEULE')
    expect(positionDe('2026-03-11')).toBe('SEULE')
  })

  it('ne fusionne pas un jour réalisé avec un jour prévisionnel', () => {
    renderCalendar({
      entries: [
        journeeLe('2026-03-09', 'a'),
        { ...journeeLe('2026-03-10', 'b'), kind: 'PREVISIONNEL' as const },
      ],
    })
    expect(positionDe('2026-03-09')).toBe('SEULE')
    expect(positionDe('2026-03-10')).toBe('SEULE')
  })

  it('ne franchit pas la fin de ligne de la grille', () => {
    // Dimanche 8 et lundi 9 mars sont contigus dans le mois mais séparés à
    // l'écran : la grille les met sur deux lignes. Une plage qui les
    // réunirait dessinerait une soudure vers un bord qui n'existe pas.
    //
    // Le mois y est rendu avec les sept jours ouvrés, sans quoi le dimanche
    // ne fusionnerait jamais et le cas ne se présenterait pas.
    renderCalendar({
      days: buildMonthDays('2026-03', [1, 2, 3, 4, 5, 6, 7], []),
      entries: [journeeLe('2026-03-08', 'a'), journeeLe('2026-03-09', 'b')],
    })
    expect(positionDe('2026-03-08')).toBe('SEULE')
    expect(positionDe('2026-03-09')).toBe('SEULE')
  })

  it('n ajoute aucune largeur à la case, quelle que soit sa position', () => {
    // Le test de budget ne compte que la gouttière `gap-*` : il ne voit pas
    // les marges d'une case. `mx-0.5` sur les bouts ferait tomber la colonne
    // réelle à 42,7 points en le laissant vert à 46,7 — le faux test que ce
    // projet a payé vingt fois. Les bordures intérieures deviennent donc
    // transparentes, jamais nulles : une bordure transparente occupe toujours
    // sa largeur, et la boîte reste identique dans les quatre cas.
    renderCalendar({
      entries: [journeeLe('2026-03-09', 'a'), journeeLe('2026-03-10', 'b'), journeeLe('2026-03-11', 'c')],
    })

    const positions = ['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12'].map((d) =>
      classes(caseDu(d)),
    )
    for (const c of positions) {
      // Aucune marge, dans aucun sens, positive ou négative.
      expect(c.filter((n) => /^-?m[xytrbl]?-/.test(n))).toEqual([])
      // Et la bordure reste déclarée : elle change de teinte, pas de largeur.
      expect(c.filter((n) => /^border-[0-9]+$/.test(n) || n === 'border')).toHaveLength(1)
      expect(c).not.toContain('border-0')
      expect(c).not.toContain('border-x-0')
      expect(c).not.toContain('border-r-0')
      expect(c).not.toContain('border-l-0')
    }
  })

  it('efface les filets intérieurs sans toucher aux extérieurs', () => {
    renderCalendar({
      entries: [journeeLe('2026-03-09', 'a'), journeeLe('2026-03-10', 'b'), journeeLe('2026-03-11', 'c')],
    })
    expect(classes(caseDu('2026-03-09'))).toContain('border-r-transparent')
    expect(classes(caseDu('2026-03-10'))).toContain('border-x-transparent')
    expect(classes(caseDu('2026-03-11'))).toContain('border-l-transparent')
    // Une case isolée garde ses quatre filets visibles.
    expect(classes(caseDu('2026-03-12')).filter((c) => c.includes('-transparent'))).toEqual([])
  })

  it('soude les aplats par-dessus la gouttière, sans occuper de place', () => {
    // L'aplat est posé en absolu : un débord négatif couvre la gouttière et
    // relie les deux cases sans peser d'un point sur le budget des sept
    // colonnes.
    renderCalendar({
      entries: [journeeLe('2026-03-09', 'a'), journeeLe('2026-03-10', 'b'), journeeLe('2026-03-11', 'c')],
    })
    const aplat = (date: string) => classes(screen.getByTestId(`remplissage-${date}`))
    expect(aplat('2026-03-09')).toContain('-mr-0.5')
    expect(aplat('2026-03-10')).toContain('-mx-0.5')
    expect(aplat('2026-03-11')).toContain('-ml-0.5')
  })

  it('ne soude rien sous une case isolée', () => {
    renderCalendar({ entries: [journeeLe('2026-03-10', 'b')] })
    const aplat = classes(screen.getByTestId('remplissage-2026-03-10'))
    expect(aplat.filter((c) => /^-m/.test(c))).toEqual([])
  })
})
