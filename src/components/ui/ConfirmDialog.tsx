'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from './Button'

const FOCALISABLES = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Superposition simple plutôt que `<dialog>` : `showModal()` n'est pas
 * uniformément implémenté par happy-dom, et une boîte de confirmation dont
 * on ne peut pas tester la fermeture ne vaut rien.
 *
 * `aria-modal="true"` promet aux technologies d'assistance que le reste du
 * document est hors d'atteinte. Trois choses le rendent vrai, et elles vont
 * ensemble : le focus est piégé dans le panneau, il est rendu au déclencheur
 * à la fermeture, et Échap est écouté sur le document — pas sur un `<div>`
 * non focalisable, qui cesserait de recevoir la touche dès que le focus le
 * quitte.
 */
export function ConfirmDialog({
  trigger,
  title,
  message,
  confirmLabel,
  action,
}: {
  trigger: string
  title: string
  message: string
  confirmLabel: string
  action: () => void | Promise<void>
}) {
  const [ouvert, setOuvert] = useState(false)
  const panneau = useRef<HTMLDivElement>(null)
  const confirmer = useRef<HTMLButtonElement>(null)
  /** Élément focalisé à l'ouverture : c'est à lui que le focus revient. */
  const origine = useRef<HTMLElement | null>(null)

  const fermer = useCallback(() => {
    setOuvert(false)
    origine.current?.focus()
    origine.current = null
  }, [])

  const ouvrir = useCallback(() => {
    origine.current = document.activeElement as HTMLElement | null
    setOuvert(true)
  }, [])

  useEffect(() => {
    if (!ouvert) return
    confirmer.current?.focus()
  }, [ouvert])

  useEffect(() => {
    if (!ouvert) return

    const surTouche = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        fermer()
        return
      }
      if (ev.key !== 'Tab') return

      const cibles = Array.from(
        panneau.current?.querySelectorAll<HTMLElement>(FOCALISABLES) ?? [],
      )
      if (cibles.length === 0) return

      const premier = cibles[0]!
      const dernier = cibles[cibles.length - 1]!
      const actif = document.activeElement

      // Le focus sort du panneau : on le ramène de l'autre côté du cycle.
      if (ev.shiftKey ? actif === premier : actif === dernier) {
        ev.preventDefault()
        ;(ev.shiftKey ? dernier : premier).focus()
      } else if (actif === null || !cibles.includes(actif as HTMLElement)) {
        ev.preventDefault()
        ;(ev.shiftKey ? dernier : premier).focus()
      }
    }

    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [ouvert, fermer])

  return (
    <>
      <Button type="button" variant="secondary" onClick={ouvrir}>
        {trigger}
      </Button>

      {ouvert && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-deep/40 p-4"
        >
          <div
            ref={panneau}
            className="w-full max-w-md rounded-lg border border-rule bg-surface p-4 shadow-float"
          >
            <h2 className="mb-2 text-lg">{title}</h2>
            <p className="mb-4 text-sm text-muted">{message}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="quiet" onClick={fermer}>
                Annuler
              </Button>
              <Button
                ref={confirmer}
                type="button"
                variant="primary"
                onClick={async () => {
                  await action()
                  fermer()
                }}
              >
                {confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
