'use client'

import { useEffect } from 'react'

/** Enregistre la coquille. N'affiche rien et n'échoue jamais bruyamment. */
export function RegisterServiceWorker(): null {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Un enregistrement refusé (http non sécurisé, navigation privée) ne
      // doit pas empêcher d'utiliser l'application.
    })
  }, [])

  return null
}
