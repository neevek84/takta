// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
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

  it('se referme sur Échap', () => {
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
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
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
