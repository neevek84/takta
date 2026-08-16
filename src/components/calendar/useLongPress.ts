'use client'

import { useCallback, useRef } from 'react'

/** Ce que le geste retient d'un événement de pointeur : où il se trouve. */
interface PointDuPointeur {
  clientX: number
  clientY: number
}

/**
 * Distance, en pixels, au-delà de laquelle le geste n'est plus un appui mais
 * un glissement.
 *
 * Un doigt posé n'est jamais parfaitement immobile : annuler au premier pixel
 * rendrait l'appui long inatteignable au pouce. Dix pixels sont bien en deçà
 * de la cible tactile de 44 points, donc invisibles à l'usage.
 */
const SEUIL_DE_GLISSEMENT = 10

/**
 * Appui long — l'équivalent au pouce du clic droit de la souris.
 *
 * Le drapeau `consommerAppuiLong` existe parce que relever le doigt après un
 * appui long produit aussi un `click` : sans lui, le formulaire s'ouvrirait
 * puis la case avancerait d'un cran derrière lui.
 *
 * Le geste s'annule aussi dès que le doigt s'éloigne, et pas seulement quand
 * il quitte la case : le navigateur n'émet pas toujours un `pointercancel` en
 * prenant la main sur un défilement, et un doigt qui fait défiler la page sans
 * sortir de la case ouvrait alors le formulaire par surprise.
 */
export function useLongPress(
  onLongPress: () => void,
  delayMs = 500,
): {
  handlers: {
    onPointerDown: (ev?: PointDuPointeur) => void
    onPointerMove: (ev?: PointDuPointeur) => void
    onPointerUp: () => void
    onPointerLeave: () => void
    onPointerCancel: () => void
  }
  consommerAppuiLong: () => boolean
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const declenche = useRef(false)
  const depart = useRef<PointDuPointeur | null>(null)

  const annuler = useCallback(() => {
    depart.current = null
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const demarrer = useCallback(
    (ev?: PointDuPointeur) => {
      annuler()
      declenche.current = false
      depart.current = ev === undefined ? null : { clientX: ev.clientX, clientY: ev.clientY }
      timer.current = setTimeout(() => {
        timer.current = null
        depart.current = null
        declenche.current = true
        onLongPress()
      }, delayMs)
    },
    [annuler, delayMs, onLongPress],
  )

  const surMouvement = useCallback(
    (ev?: PointDuPointeur) => {
      const origine = depart.current
      if (origine === null || ev === undefined) return
      const dx = Math.abs(ev.clientX - origine.clientX)
      const dy = Math.abs(ev.clientY - origine.clientY)
      if (dx > SEUIL_DE_GLISSEMENT || dy > SEUIL_DE_GLISSEMENT) annuler()
    },
    [annuler],
  )

  const consommerAppuiLong = useCallback((): boolean => {
    const oui = declenche.current
    declenche.current = false
    return oui
  }, [])

  return {
    handlers: {
      onPointerDown: demarrer,
      onPointerMove: surMouvement,
      onPointerUp: annuler,
      onPointerLeave: annuler,
      onPointerCancel: annuler,
    },
    consommerAppuiLong,
  }
}
