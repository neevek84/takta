// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BoutonAgenda } from './BoutonAgenda'

const onResultat = vi.fn()

describe('BoutonAgenda', () => {
  afterEach(() => {
    cleanup()
    onResultat.mockClear()
  })

  it('affirme le vide plutot que de ne rien dire', async () => {
    render(
      <BoutonAgenda
        du="2026-03-01"
        au="2026-03-31"
        verifier={async () => ({ ok: true, jours: [] })}
        onResultat={onResultat}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Vérifier l’agenda/ }))

    expect(screen.getByRole('status').textContent).toContain('Aucune occupation')
  })

  it('compte les jours occupes', async () => {
    render(
      <BoutonAgenda
        du="2026-03-01"
        au="2026-03-31"
        verifier={async () => ({ ok: true, jours: ['2026-03-04', '2026-03-12'] })}
        onResultat={onResultat}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Vérifier l’agenda/ }))

    expect(screen.getByRole('status').textContent).toContain('2 jours occupés')
    expect(onResultat).toHaveBeenCalledWith(['2026-03-04', '2026-03-12'])
  })

  // L'utilisateur a demande. Le silence serait un mensonge.
  it('dit quand l agenda n a pas repondu', async () => {
    render(
      <BoutonAgenda
        du="2026-03-01"
        au="2026-03-31"
        verifier={async () => ({ ok: false, raison: 'ECHEC' })}
        onResultat={onResultat}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Vérifier l’agenda/ }))

    expect(screen.getByRole('status').textContent).toContain('n’a pas répondu')
    expect(screen.getByRole('status').textContent).toContain('La saisie continue')
  })
})
