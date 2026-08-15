// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Card } from './Card'
import { DataTable } from './DataTable'
import { Badge } from './Badge'
import { Banner } from './Banner'
import { ConfirmDialog } from './ConfirmDialog'
import { PageShell } from './PageShell'

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
})

describe('Badge', () => {
  it('porte un glyphe en plus de la teinte', () => {
    // Quatre statuts qui ne se distingueraient que par la couleur seraient
    // indiscernables pour un daltonien.
    render(
      <Badge tone="success" glyph="✓">
        Validé
      </Badge>,
    )
    const badge = screen.getByText(/Validé/)
    expect(badge.textContent).toContain('✓')
  })

  it('cache le glyphe aux lecteurs d écran, qui lisent déjà le libellé', () => {
    const { container } = render(
      <Badge tone="danger" glyph="✕">
        Refusé
      </Badge>,
    )
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe('✕')
  })

  it('habille chaque teinte par des jetons', () => {
    const { container } = render(
      <Badge tone="warning" glyph="▲">
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
  it('porte un glyphe distinct par tonalité, sans que l appelant ait à y penser', () => {
    const glyphes = new Set<string>()
    for (const tone of ['success', 'warning', 'danger', 'info'] as const) {
      const { container } = render(<Banner tone={tone}>message</Banner>)
      const glyphe = container.querySelector('[aria-hidden="true"]')
      expect(glyphe, tone).not.toBeNull()
      expect(glyphe!.textContent, tone).not.toBe('')
      glyphes.add(glyphe!.textContent!)
      cleanup()
    }
    expect(glyphes.size).toBe(4)
  })

  it('cache le glyphe aux lecteurs d écran, que le rôle renseigne déjà', () => {
    const { container } = render(<Banner tone="danger">Le CRA est validé.</Banner>)
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('accepte un glyphe explicite', () => {
    const { container } = render(
      <Banner tone="info" glyph="★">
        message
      </Banner>,
    )
    expect(container.querySelector('[aria-hidden="true"]')!.textContent).toBe('★')
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
})
