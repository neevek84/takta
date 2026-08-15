// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDragSelect } from './useDragSelect'

describe('useDragSelect', () => {
  it('sélectionne une seule cellule sur un clic simple', () => {
    const { result } = renderHook(() => useDragSelect(vi.fn()))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-02'))
    act(() => result.current.handlers.onMouseUp())

    expect(result.current.isSelected('l1', '2026-03-02')).toBe(true)
  })

  it('sélectionne une plage en glissant vers la droite', () => {
    const { result } = renderHook(() => useDragSelect(vi.fn()))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-02'))
    act(() => result.current.handlers.onMouseEnter('l1', '2026-03-06'))

    for (const d of ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06']) {
      expect(result.current.isSelected('l1', d)).toBe(true)
    }
  })

  it('sélectionne une plage en glissant vers la gauche', () => {
    const { result } = renderHook(() => useDragSelect(vi.fn()))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-06'))
    act(() => result.current.handlers.onMouseEnter('l1', '2026-03-04'))

    expect(result.current.isSelected('l1', '2026-03-04')).toBe(true)
    expect(result.current.isSelected('l1', '2026-03-05')).toBe(true)
    expect(result.current.isSelected('l1', '2026-03-06')).toBe(true)
  })

  it('ne franchit jamais une ligne', () => {
    const { result } = renderHook(() => useDragSelect(vi.fn()))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-02'))
    act(() => result.current.handlers.onMouseEnter('l2', '2026-03-06'))

    expect(result.current.isSelected('l2', '2026-03-06')).toBe(false)
    expect(result.current.isSelected('l1', '2026-03-02')).toBe(true)
  })

  it('applique une valeur à toute la sélection', () => {
    const onApply = vi.fn()
    const { result } = renderHook(() => useDragSelect(onApply))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-02'))
    act(() => result.current.handlers.onMouseEnter('l1', '2026-03-04'))
    act(() => result.current.handlers.onMouseUp())
    act(() => result.current.applyToSelection('1'))

    expect(onApply).toHaveBeenCalledWith(
      { lineId: 'l1', dates: ['2026-03-02', '2026-03-03', '2026-03-04'] },
      '1',
    )
  })

  it('vide la sélection', () => {
    const { result } = renderHook(() => useDragSelect(vi.fn()))

    act(() => result.current.handlers.onMouseDown('l1', '2026-03-02'))
    act(() => result.current.clear())

    expect(result.current.isSelected('l1', '2026-03-02')).toBe(false)
  })
})
