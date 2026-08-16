'use client'

import { useCallback, useRef } from 'react'

/**
 * Appui long — l'équivalent au pouce du clic droit de la souris.
 *
 * Le drapeau `consommerAppuiLong` existe parce que relever le doigt après un
 * appui long produit aussi un `click` : sans lui, le formulaire s'ouvrirait
 * puis la case avancerait d'un cran derrière lui.
 */
export function useLongPress(
  onLongPress: () => void,
  delayMs = 500,
): {
  handlers: {
    onPointerDown: () => void
    onPointerUp: () => void
    onPointerLeave: () => void
    onPointerCancel: () => void
  }
  consommerAppuiLong: () => boolean
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const declenche = useRef(false)

  const annuler = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const demarrer = useCallback(() => {
    annuler()
    declenche.current = false
    timer.current = setTimeout(() => {
      timer.current = null
      declenche.current = true
      onLongPress()
    }, delayMs)
  }, [annuler, delayMs, onLongPress])

  const consommerAppuiLong = useCallback((): boolean => {
    const oui = declenche.current
    declenche.current = false
    return oui
  }, [])

  return {
    handlers: {
      onPointerDown: demarrer,
      onPointerUp: annuler,
      onPointerLeave: annuler,
      onPointerCancel: annuler,
    },
    consommerAppuiLong,
  }
}
