// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useLongPress } from './useLongPress'

describe('useLongPress', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('déclenche après le délai', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress, 500))

    act(() => result.current.handlers.onPointerDown())
    expect(onLongPress).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(500))
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('ne déclenche pas si le doigt se relève avant le délai', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress, 500))

    act(() => result.current.handlers.onPointerDown())
    act(() => vi.advanceTimersByTime(300))
    act(() => result.current.handlers.onPointerUp())
    act(() => vi.advanceTimersByTime(500))

    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('ne déclenche pas si le doigt quitte la case', () => {
    const onLongPress = vi.fn()
    const { result } = renderHook(() => useLongPress(onLongPress, 500))

    act(() => result.current.handlers.onPointerDown())
    act(() => result.current.handlers.onPointerLeave())
    act(() => vi.advanceTimersByTime(500))

    expect(onLongPress).not.toHaveBeenCalled()
  })

  // Sans ce drapeau, l'appui long ouvrirait le formulaire et le clic qui suit
  // ferait avancer la case d'un cran derrière lui.
  it('signale une fois, et une seule, que le clic suivant doit être ignoré', () => {
    const { result } = renderHook(() => useLongPress(vi.fn(), 500))

    act(() => result.current.handlers.onPointerDown())
    act(() => vi.advanceTimersByTime(500))

    expect(result.current.consommerAppuiLong()).toBe(true)
    expect(result.current.consommerAppuiLong()).toBe(false)
  })

  it('ne signale rien après un appui court', () => {
    const { result } = renderHook(() => useLongPress(vi.fn(), 500))

    act(() => result.current.handlers.onPointerDown())
    act(() => result.current.handlers.onPointerUp())

    expect(result.current.consommerAppuiLong()).toBe(false)
  })
})
