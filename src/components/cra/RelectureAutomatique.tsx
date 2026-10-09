'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Pendant l'attente d'une signature : assez souvent pour la voir arriver, pas plus. */
const INTERVALLE_MS = 30_000

/**
 * Relit l'écran du CRA sans que personne n'ait à recharger la page.
 *
 * **Pourquoi.** La signature arrive par le webhook du prestataire ou par la
 * page du client — jamais par ce navigateur. Le cache de navigation de Next
 * resservait donc l'état mémorisé : revenu sur un CRA signé, on le voyait
 * encore « envoyé » jusqu'à un rechargement forcé. Constaté en production.
 *
 * Deux déclencheurs : le retour sur l'onglet, toujours ; et, tant que le CRA
 * attend la réponse du client, une relecture toutes les trente secondes.
 * `router.refresh()` ne recharge pas la page : il redemande l'état au serveur
 * et garde la saisie en cours dans les champs.
 */
export function RelectureAutomatique({ enAttente }: { enAttente: boolean }) {
  const router = useRouter()

  useEffect(() => {
    const relire = () => router.refresh()
    const siVisible = () => {
      if (document.visibilityState === 'visible') relire()
    }
    window.addEventListener('focus', relire)
    document.addEventListener('visibilitychange', siVisible)
    const minuterie = enAttente ? window.setInterval(relire, INTERVALLE_MS) : undefined
    return () => {
      window.removeEventListener('focus', relire)
      document.removeEventListener('visibilitychange', siVisible)
      if (minuterie !== undefined) window.clearInterval(minuterie)
    }
  }, [enAttente, router])

  return null
}
