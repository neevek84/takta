'use client'

import { useCallback, useState } from 'react'

export interface DragSelection {
  lineId: string
  dates: string[]
}

interface DragState {
  lineId: string
  anchor: string
  head: string
  dragging: boolean
}

function rangeBetween(a: string, b: string): string[] {
  const [from, to] = a <= b ? [a, b] : [b, a]
  const out: string[] = []
  const cursor = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)

  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return out
}

export function useDragSelect(onApply: (sel: DragSelection, raw: string) => void) {
  const [state, setState] = useState<DragState | null>(null)

  const onMouseDown = useCallback((lineId: string, date: string) => {
    setState({ lineId, anchor: date, head: date, dragging: true })
  }, [])

  const onMouseEnter = useCallback((lineId: string, date: string) => {
    setState((s) => {
      if (!s || !s.dragging) return s
      if (s.lineId !== lineId) return s // la sélection ne franchit pas une ligne
      return { ...s, head: date }
    })
  }, [])

  const onMouseUp = useCallback(() => {
    setState((s) => (s ? { ...s, dragging: false } : s))
  }, [])

  /**
   * Étend la sélection jusqu'à `date`, sans glissement en cours.
   *
   * C'est la primitive des deux équivalents du glissement : Maj+flèche au
   * clavier, et le doigt qui touche un autre jour — un doigt n'ayant pas de
   * touche Maj. Faute de sélection, elle s'ancre sur `ancre`, la case d'où le
   * geste part.
   */
  const extendTo = useCallback((lineId: string, ancre: string, date: string) => {
    setState((s) =>
      s !== null && s.lineId === lineId
        ? { ...s, head: date, dragging: false }
        : { lineId, anchor: ancre, head: date, dragging: false },
    )
  }, [])

  const clear = useCallback(() => setState(null), [])

  const selection: DragSelection | null = state
    ? { lineId: state.lineId, dates: rangeBetween(state.anchor, state.head) }
    : null

  const isSelected = useCallback(
    (lineId: string, date: string): boolean => {
      if (!state || state.lineId !== lineId) return false
      return rangeBetween(state.anchor, state.head).includes(date)
    },
    [state],
  )

  const applyToSelection = useCallback(
    (raw: string) => {
      if (selection) onApply(selection, raw)
    },
    [selection, onApply],
  )

  return {
    selection,
    isSelected,
    handlers: { onMouseDown, onMouseEnter, onMouseUp },
    extendTo,
    applyToSelection,
    clear,
  }
}
