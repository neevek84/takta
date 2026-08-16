// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Aplat } from './Aplat'
import { Card } from './Card'
import { DataTable } from './DataTable'
import { Badge } from './Badge'
import { Banner } from './Banner'
import { IconeAvertissement, IconeDanger, IconeSucces } from './icons'
import { ConfirmDialog } from './ConfirmDialog'
import { PageShell } from './PageShell'
import {
  SegmentLegend,
  SEGMENT_PREVU,
  SEGMENT_PREVU_BORDURE,
  SEGMENT_REALISE,
} from './SegmentLegend'
import { NON_TEXT_PAIRS, THEME_TOKEN_KEYS, type ThemeTokens } from '@/core/theme/tokens'

afterEach(cleanup)

describe('Card', () => {
  it('rend son titre et son contenu', () => {
    render(<Card title="Suivi">contenu</Card>)
    expect(screen.getByRole('heading', { name: 'Suivi' })).toBeDefined()
    expect(screen.getByText('contenu')).toBeDefined()
  })

  it('se passe de titre', () => {
    render(<Card>seul</Card>)
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('se soulève au survol, en douceur', () => {
    const { container } = render(<Card>contenu</Card>)
    const classes = container.firstElementChild!.className
    expect(classes).toContain('shadow-card')
    expect(classes).toContain('hover:shadow-lift')
    expect(classes).toContain('transition-shadow')
    expect(classes).toContain('duration-150')
  })

  it('laisse l appelant remplacer une classe de la carte', () => {
    const { container } = render(<Card className="p-0">contenu</Card>)
    const classes = container.firstElementChild!.className
    expect(classes).toContain('p-0')
    expect(classes).not.toContain('p-4')
  })
})

describe('Aplat', () => {
  const teinte = { bg: 'bg-accent', text: 'text-on-accent', border: 'border-accent-dark' }

  it("donne au remplissage une épaisseur, sans lui retirer sa teinte", () => {
    // Un aplat mort est plat quelle que soit sa couleur. Le voile se pose
    // **sur** la teinte : les deux propriétés ne se recouvrent pas, et la
    // teinte doit donc survivre à la composition.
    const { container } = render(
      <Aplat cle="2026-08-10" forme={{ kind: 'PLEINE' }} couleur={teinte} />,
    )
    const classes = container.firstElementChild!.className
    expect(classes).toContain('aplat-relief')
    expect(classes).toContain('bg-accent')
  })

  it('garde sa découpe de demi-journée', () => {
    const { container } = render(
      <Aplat cle="2026-08-10" forme={{ kind: 'MOITIE', moment: 'AM' }} couleur={teinte} />,
    )
    expect(container.firstElementChild!.className).toContain('clip-half-am')
  })
})

describe('DataTable', () => {
  it('porte une légende accessible et laisse défiler horizontalement', () => {
    const { container } = render(
      <DataTable caption="Plan de charge">
        <tbody>
          <tr>
            <td>1</td>
          </tr>
        </tbody>
      </DataTable>,
    )
    expect(screen.getByText('Plan de charge')).toBeDefined()
    expect(container.firstElementChild!.className).toContain('overflow-x-auto')
  })

  // Chaque écran de l'application est une colonne de nombres. Sans chasse
  // fixe, « 11 » et « 100 » ne s'alignent pas d'une ligne à l'autre et la
  // colonne se lit mal.
  it('aligne les chiffres du tableau sur une chasse fixe', () => {
    const { container } = render(
      <DataTable caption="Plan de charge">
        <tbody>
          <tr>
            <td>1</td>
          </tr>
        </tbody>
      </DataTable>,
    )
    expect(container.querySelector('table')!.className).toContain('tabular-nums')
  })
})

describe('Badge', () => {
  it('porte une icône en plus de la teinte', () => {
    // Quatre statuts qui ne se distingueraient que par la couleur seraient
    // indiscernables pour un daltonien. L'assertion lit `data-icone` et non
    // le texte : un tracé n'a pas de `textContent`, et le compter pour vide
    // ferait passer un badge qui aurait perdu son marqueur.
    const { container } = render(
      <Badge tone="success" icone={IconeSucces}>
        Validé
      </Badge>,
    )
    expect(screen.getByText(/Validé/).textContent).toContain('Validé')
    expect(container.querySelector('svg[data-icone="succes"]')).not.toBeNull()
  })

  it('cache l icône aux lecteurs d écran, qui lisent déjà le libellé', () => {
    const { container } = render(
      <Badge tone="danger" icone={IconeDanger}>
        Refusé
      </Badge>,
    )
    const icone = container.querySelector('[aria-hidden="true"]')
    expect(icone).not.toBeNull()
    expect(icone!.tagName.toLowerCase()).toBe('svg')
    expect(icone!.getAttribute('data-icone')).toBe('danger')
  })

  it('habille chaque teinte par des jetons', () => {
    const { container } = render(
      <Badge tone="warning" icone={IconeAvertissement}>
        Attention
      </Badge>,
    )
    expect(container.firstElementChild!.className).toMatch(/warning/)
  })
})

describe('Banner', () => {
  it('annonce son contenu aux lecteurs d écran', () => {
    render(<Banner tone="danger">Le CRA est validé.</Banner>)
    expect(screen.getByRole('alert').textContent).toContain('Le CRA est validé.')
  })

  it('utilise un statut, pas une alerte, pour l information', () => {
    render(<Banner tone="info">Prévisionnel</Banner>)
    expect(screen.getByRole('status').textContent).toContain('Prévisionnel')
  })

  it('rend son titre quand il en a un', () => {
    render(
      <Banner tone="warning" title="Capacité dépassée">
        720 h saisies.
      </Banner>,
    )
    expect(screen.getByText('Capacité dépassée')).toBeDefined()
  })

  // I3 — les quatre fonds d'état sont à 0,0028 d'écart de luminance entre
  // `danger` et `info` : en niveaux de gris, ce sont le même encart. Comme
  // `Badge`, `Banner` doit porter un glyphe propre à sa tonalité, y compris
  // quand l'appelant ne fournit ni titre ni glyphe.
  it('porte une icône distincte par tonalité, sans que l appelant ait à y penser', () => {
    // `data-icone` nomme le tracé. Deux tonalités qui rendraient le même
    // dessin passeraient inaperçues à l'œil comme au `querySelector('svg')`.
    const icones = new Set<string>()
    for (const tone of ['success', 'warning', 'danger', 'info'] as const) {
      const { container } = render(<Banner tone={tone}>message</Banner>)
      const icone = container.querySelector('[aria-hidden="true"]')
      expect(icone, tone).not.toBeNull()
      expect(icone!.getAttribute('data-icone'), tone).toBeTruthy()
      icones.add(icone!.getAttribute('data-icone')!)
      cleanup()
    }
    expect(icones.size).toBe(4)
  })

  it('cache l icône aux lecteurs d écran, que le rôle renseigne déjà', () => {
    const { container } = render(<Banner tone="danger">Le CRA est validé.</Banner>)
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('accepte une icône explicite', () => {
    const { container } = render(
      <Banner tone="info" icone={IconeSucces}>
        message
      </Banner>,
    )
    expect(container.querySelector('[aria-hidden="true"]')!.getAttribute('data-icone')).toBe(
      'succes',
    )
  })

  // Les états se distinguaient par des caractères — `◆ ✓ ▲ ✕ ℹ` — rendus dans
  // la police système, chacun avec sa métrique, son alignement et sa présence
  // propres : `ℹ` manque à des polices embarquées, et le rendu bascule alors
  // sur un glyphe de substitution qui ne dit plus rien.
  it('rend un glyphe dessiné, pas un caractère de la police système', () => {
    render(<Banner tone="danger">Dépassement</Banner>)
    const svg = document.querySelector('[role="alert"] svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('aria-hidden')).toBe('true')
    expect(screen.getByRole('alert').textContent).not.toContain('✕')
  })
})

describe('ConfirmDialog', () => {
  it('ne montre rien avant le clic', () => {
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner les saisies"
        message="Les mois validés ne seront pas touchés."
        confirmLabel="Réétalonner"
        action={vi.fn()}
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ouvre une boîte de dialogue nommée', () => {
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner les saisies"
        message="Les mois validés ne seront pas touchés."
        confirmLabel="Réétalonner"
        action={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Réétalonner' }))
    const dialogue = screen.getByRole('dialog')
    expect(dialogue.getAttribute('aria-modal')).toBe('true')
    expect(dialogue.textContent).toContain('Les mois validés ne seront pas touchés.')
  })

  it('se referme sur Annuler sans rien déclencher', () => {
    const action = vi.fn()
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner les saisies"
        message="Irréversible."
        confirmLabel="Réétalonner"
        action={action}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Réétalonner' }))
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(action).not.toHaveBeenCalled()
  })

  it('se referme sur Échap même quand le focus a quitté le panneau', () => {
    // Envoyer la touche sur le dialogue lui-même court-circuiterait exactement
    // la condition qui échoue en vrai : le `<div role="dialog">` n'est pas
    // focalisable, un clic sur le voile pose le focus sur `<body>`, et
    // l'événement clavier ne remonte alors jamais jusqu'au panneau.
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner"
        message="Irréversible."
        confirmLabel="Confirmer"
        action={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Réétalonner' }))
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)

    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // C1 — `onAccent` sur `accentDark` tombe à 4,24:1, sous le 4,5:1 absolu.
  // C'est la raison précise pour laquelle `Button` inverse au lieu d'assombrir.
  it('n assombrit pas l or sous son encre au survol du bouton de confirmation', () => {
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner"
        message="Irréversible."
        confirmLabel="Confirmer"
        action={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Réétalonner' }))
    const confirmer = screen.getByRole('button', { name: 'Confirmer' })
    expect(confirmer.className).not.toContain('accent-dark')
    // Le survol de la variante `primary` : inversion, pas assombrissement.
    expect(confirmer.className).toContain('hover:bg-ink-deep')
    expect(confirmer.className).toContain('hover:text-on-dark')
  })

  // I7 — `aria-modal="true"` promet que le reste du document est hors
  // d'atteinte. Sans piège de focus, la promesse est fausse.
  it('cycle le focus entre les commandes du panneau', () => {
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner"
        message="Irréversible."
        confirmLabel="Confirmer"
        action={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Réétalonner' }))
    const annuler = screen.getByRole('button', { name: 'Annuler' })
    const confirmer = screen.getByRole('button', { name: 'Confirmer' })
    expect(document.activeElement).toBe(confirmer)

    // Dernier élément → Tab revient au premier, il ne part pas dans la page.
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(annuler)

    // Premier élément → Shift+Tab revient au dernier.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirmer)
  })

  it('rend le focus au déclencheur à la fermeture', () => {
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner"
        message="Irréversible."
        confirmLabel="Confirmer"
        action={vi.fn()}
      />,
    )
    const declencheur = screen.getByRole('button', { name: 'Réétalonner' })
    declencheur.focus()
    fireEvent.click(declencheur)
    expect(document.activeElement).not.toBe(declencheur)

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(document.activeElement).toBe(declencheur)
  })

  it('rend le focus au déclencheur après confirmation', async () => {
    const action = vi.fn()
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner"
        message="Irréversible."
        confirmLabel="Confirmer"
        action={action}
      />,
    )
    const declencheur = screen.getByRole('button', { name: 'Réétalonner' })
    declencheur.focus()
    fireEvent.click(declencheur)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(action).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(declencheur)
  })

  it('offre des cibles tactiles sur ses trois commandes', () => {
    render(
      <ConfirmDialog
        trigger="Réétalonner"
        title="Réétalonner"
        message="Irréversible."
        confirmLabel="Confirmer"
        action={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Réétalonner' }).className).toContain('touch-target')
    fireEvent.click(screen.getByRole('button', { name: 'Réétalonner' }))
    expect(screen.getByRole('button', { name: 'Annuler' }).className).toContain('touch-target')
    expect(screen.getByRole('button', { name: 'Confirmer' }).className).toContain('touch-target')
  })
})

describe('PageShell', () => {
  it('rend un titre de niveau 1 et son contenu', () => {
    render(<PageShell title="Missions">liste</PageShell>)
    expect(screen.getByRole('heading', { level: 1, name: 'Missions' })).toBeDefined()
    expect(screen.getByText('liste')).toBeDefined()
  })

  it('accueille des actions à côté du titre', () => {
    render(
      <PageShell title="Plan de charge" actions={<span>exercice</span>}>
        contenu
      </PageShell>,
    )
    expect(screen.getByText('exercice')).toBeDefined()
  })

  // Un titre à ×1,29 du corps n'est pas un titre, c'est une étiquette en gras.
  // `--text-2xl` était déclaré depuis le lot 1e et n'était employé nulle part.
  it('donne au titre de page la taille du jeton 2xl', () => {
    render(<PageShell title="Saisie">contenu</PageShell>)
    const titre = screen.getByRole('heading', { level: 1 })
    expect(titre.className).toContain('text-2xl')
    expect(titre.className).not.toContain('text-xl')
  })
})

describe('échelle typographique', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')

  it('déclare le jeton 2xl au-dessus du titre de carte', () => {
    // 22 px contre 18 px : c'est la taille qui porte la hiérarchie, et il faut
    // donc qu'elle la porte vraiment. Comparer les deux jetons entre eux plutôt
    // que d'attendre une valeur littérale : c'est l'écart qui fait le titre.
    const valeur = (jeton: string) => {
      const trouve = new RegExp(`--text-${jeton}:\\s*([\\d.]+)rem`).exec(css)
      expect(trouve, `--text-${jeton} introuvable`).not.toBeNull()
      return Number(trouve![1])
    }
    expect(valeur('2xl')).toBeGreaterThan(valeur('xl'))
    expect(valeur('2xl') / valeur('base')).toBeGreaterThan(1.5)
  })

  it('fait porter la hiérarchie par la taille, pas par la graisse', () => {
    // 800 compensait une taille trop petite en criant. La taille porte
    // désormais la hiérarchie ; la graisse redescend à 700.
    const bloc = /h1,\s*h2,\s*h3\s*\{([^}]*)\}/.exec(css)
    expect(bloc, 'la règle h1, h2, h3 est introuvable').not.toBeNull()
    expect(bloc![1]).toMatch(/font-weight:\s*700\b/)
    expect(bloc![1]).not.toMatch(/font-weight:\s*800\b/)
  })
})

describe('échelle de matière', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8')

  const pixels = (jeton: string) => {
    const trouve = new RegExp(`--radius-${jeton}:\\s*(\\d+)px`).exec(css)
    expect(trouve, `--radius-${jeton} introuvable`).not.toBeNull()
    return Number(trouve![1])
  }

  it('donne aux rayons de quoi se voir', () => {
    // 3 / 5 / 8 px se lisent comme un angle droit imparfait, pas comme un
    // arrondi. L'échelle reste croissante — un rayon `sm` supérieur au `lg`
    // renverserait la hiérarchie des surfaces sans qu'aucune classe ne change.
    expect(pixels('sm')).toBe(6)
    expect(pixels('md')).toBe(10)
    expect(pixels('lg')).toBe(14)
    expect(pixels('sm')).toBeLessThan(pixels('md'))
    expect(pixels('md')).toBeLessThan(pixels('lg'))
  })

  it("pose l'ombre de carte en trois couches", () => {
    // Une seule couche à 10 % est indétectable : ce qui donne une élévation
    // est la superposition contact / diffusion / ambiante.
    const bloc = /--shadow-card:([^;]*);/.exec(css)
    expect(bloc, '--shadow-card introuvable').not.toBeNull()
    expect(bloc![1]!.match(/color-mix/g) ?? []).toHaveLength(3)
  })

  it("déclare une ombre d'élévation pour l'état survolé", () => {
    expect(/--shadow-lift:/.test(css)).toBe(true)
  })

  it("donne un corps à l'utilitaire qui épaissit l'aplat", () => {
    // `Aplat` pose la classe `aplat-relief` ; la présence de cette chaîne dans
    // un `className` ne dit rien de ce qu'elle dessine. Renommer l'utilitaire
    // ici laissait la classe sur le DOM et le voile disparaissait — seul apport
    // visible de la tâche 5 sur le calendrier — sans qu'un test bouge.
    const bloc = /@utility\s+aplat-relief\s*\{([^}]*)\}/.exec(css)
    expect(bloc, '@utility aplat-relief introuvable').not.toBeNull()
    // Un dégradé, et une teinte mélangée plutôt qu'un blanc en dur : c'est ce
    // qui permet au voile de suivre le thème au lieu de le trouer.
    expect(bloc![1]).toMatch(/linear-gradient/)
    expect(bloc![1]).toMatch(/color-mix/)
  })

  it('neutralise le mouvement pour qui le demande', () => {
    // Le mouvement sert la lecture ; il ne s'impose à personne. Sans cette
    // règle, les transitions du lot 1g deviennent une régression
    // d'accessibilité pour les personnes sujettes au mal des transports.
    const bloc = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\s*\}\n\s*\}/.exec(
      css,
    )
    expect(bloc, 'aucune règle prefers-reduced-motion').not.toBeNull()
    expect(bloc![1]).toMatch(/transition-duration:\s*0\.01ms\s*!important/)
    expect(bloc![1]).toMatch(/animation-duration:\s*0\.01ms\s*!important/)
  })
})

/**
 * Les deux segments que l'application dessine partout — barre d'engagement,
 * barre d'exercice, légende.
 *
 * Le prévisionnel valait `bg-accent/45 pattern-hatch` : un accent délavé, donc
 * terne par construction, et une opacité que le contrôle de contraste ne voit
 * pas — angle mort que le lot 1f documentait lui-même (1,32:1 sur sa piste).
 */
describe('les segments du réalisé et du prévisionnel', () => {
  it('donne au prévisionnel une teinte opaque, pas une opacité', () => {
    expect(SEGMENT_PREVU).toBe('bg-prevu')
    // Une opacité échappe par nature au contrôle de contraste : elle dépend de
    // ce qu'il y a dessous, que les jetons ne connaissent pas.
    expect(SEGMENT_PREVU).not.toContain('/')
  })

  it('garde au prévisionnel un marqueur qui ne tient pas à la teinte', () => {
    // Le tireté remplace la hachure. Sans lui, deux teintes opaques ne se
    // distingueraient plus en vision monochrome — la règle du projet.
    expect(SEGMENT_PREVU_BORDURE).toContain('border-dashed')
    expect(SEGMENT_REALISE).not.toContain('border-dashed')
  })

  /**
   * Le tireté se dessine **sur son propre remplissage** — même `<div>`, même
   * `className`. C'est lui, et lui seul, qui porte l'information quand la
   * teinte n'est pas perçue : un marqueur non chromatique invisible ne repère
   * rien. `NON_TEXT_PAIRS` ne confrontait `prevuEdge` qu'aux quatre fonds de
   * texte, jamais au fond qu'il borde réellement, et les cinq préréglages
   * sortaient entre 1,52 et 2,53:1 sans qu'aucun test bouge.
   *
   * Le couple est lu sur le DOM, jamais écrit à la main : changer la bordure
   * ou la teinte du segment le fait entrer dans le contrôle tout seul.
   */
  it('fait entrer le tireté et son propre fond dans le contrôle non textuel', () => {
    render(<SegmentLegend />)
    const pastille = screen
      .getByTestId('legende-segments')
      .querySelectorAll('[aria-hidden="true"]')[1]!
    const classes = pastille.className.split(/\s+/).filter((c) => c !== '')

    const jetonPar = (prefixe: string): keyof ThemeTokens | undefined => {
      for (const k of THEME_TOKEN_KEYS) {
        if (classes.includes(`${prefixe}-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`)) {
          return k
        }
      }
      return undefined
    }

    const fond = jetonPar('bg')
    const bordure = jetonPar('border')
    expect(fond, 'aucun fond de jeton sur la pastille du prévisionnel').toBeDefined()
    expect(bordure, 'aucune bordure de jeton sur la pastille du prévisionnel').toBeDefined()
    expect(NON_TEXT_PAIRS).toContainEqual({ text: bordure!, background: fond! })
  })

  it('habille les pastilles de la légende comme les segments qu elles nomment', () => {
    render(<SegmentLegend />)
    const pastilles = screen.getByTestId('legende-segments').querySelectorAll('[aria-hidden="true"]')
    expect(pastilles).toHaveLength(2)
    expect(pastilles[0]!.className).toContain(SEGMENT_REALISE)
    expect(pastilles[1]!.className).toContain(SEGMENT_PREVU)
    expect(pastilles[1]!.className).toContain('border-dashed')
    expect(pastilles[0]!.className).not.toContain('border-dashed')
  })
})
