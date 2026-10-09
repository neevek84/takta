// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { RelectureAutomatique } from './RelectureAutomatique'

beforeEach(() => {
  refresh.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RelectureAutomatique', () => {
  // Constaté en production : la signature arrive par le webhook ou par la page
  // du client, jamais par ce navigateur. Revenu sur l'écran du CRA, on voyait
  // l'état mémorisé — « envoyé » — jusqu'à un rechargement forcé.
  it('relit la page quand l onglet redevient visible', () => {
    render(<RelectureAutomatique enAttente={false} />)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('relit périodiquement tant que le CRA attend la signature', () => {
    render(<RelectureAutomatique enAttente />)
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('ne relit pas périodiquement un CRA qui n attend rien', () => {
    render(<RelectureAutomatique enAttente={false} />)
    act(() => {
      vi.advanceTimersByTime(120_000)
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('cesse tout quand l écran se ferme', () => {
    const { unmount } = render(<RelectureAutomatique enAttente />)
    unmount()
    act(() => {
      vi.advanceTimersByTime(60_000)
      window.dispatchEvent(new Event('focus'))
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('ne rend rien à l écran', () => {
    const { container } = render(<RelectureAutomatique enAttente />)
    expect(container.innerHTML).toBe('')
  })
})
