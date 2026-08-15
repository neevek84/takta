'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Superposition simple plutôt que `<dialog>` : `showModal()` n'est pas
 * uniformément implémenté par happy-dom, et une boîte de confirmation dont
 * on ne peut pas tester la fermeture ne vaut rien.
 *
 * NOTE d'intégration : le composant `Button` partagé (tâche 7, contrôles)
 * n'existe pas encore de façon fiable au moment où cette surface est écrite.
 * Les trois boutons ci-dessous sont de simples `<button>` habillés par les
 * jetons — pas une réimplémentation de `Button`. Une tâche ultérieure devra
 * les faire pointer vers `Button` une fois disponible.
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
  const confirmer = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (ouvert) confirmer.current?.focus()
  }, [ouvert])

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="touch-target inline-flex items-center justify-center rounded-md border border-rule bg-surface px-3 text-sm font-medium text-ink hover:bg-off"
      >
        {trigger}
      </button>

      {ouvert && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onKeyDown={(ev) => {
            if (ev.key === 'Escape') setOuvert(false)
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-deep/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-rule bg-surface p-4 shadow-float">
            <h2 className="mb-2 text-lg">{title}</h2>
            <p className="mb-4 text-sm text-muted">{message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOuvert(false)}
                className="touch-target inline-flex items-center justify-center rounded-md px-3 text-sm font-medium text-ink hover:bg-off"
              >
                Annuler
              </button>
              <button
                ref={confirmer}
                type="button"
                onClick={async () => {
                  await action()
                  setOuvert(false)
                }}
                className="touch-target inline-flex items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-dark"
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
