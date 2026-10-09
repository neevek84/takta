'use client'

import { useEffect, useState } from 'react'
import { COOKIE_ANNONCE, type Annonce } from '@/core/annonce/annonce'
import { Banner } from './Banner'

const DUREE_SUCCES_MS = 8000

/**
 * Affiche l'annonce de la dernière action, puis l'efface.
 *
 * Le cookie est supprimé dès l'affichage : laissé en place, il ressortirait à
 * la navigation suivante et dirait « créé » d'une chose déjà ancienne.
 *
 * Le bandeau **flotte** en haut de l'écran : posé en tête de page, il restait
 * hors de vue de qui venait de cliquer en bas d'un long formulaire. Un succès
 * s'efface seul ; un refus ou un avertissement reste jusqu'à ce qu'on le
 * ferme — c'est celui-là qu'il ne faut pas rater.
 */
export function AnnonceFlash({ annonce }: { annonce: Annonce | null }) {
  const [visible, setVisible] = useState<Annonce | null>(annonce)

  useEffect(() => {
    if (annonce === null) return
    setVisible(annonce)
    document.cookie = `${COOKIE_ANNONCE}=; Max-Age=0; path=/`
    if (annonce.ton !== 'success' && annonce.ton !== 'info') return
    const minuterie = setTimeout(() => setVisible(null), DUREE_SUCCES_MS)
    return () => clearTimeout(minuterie)
  }, [annonce?.id])

  if (visible === null) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-xl items-start gap-2 rounded-md bg-surface shadow-lg">
        <div className="min-w-0 flex-1">
          <Banner tone={visible.ton}>{visible.message}</Banner>
        </div>
        <button
          type="button"
          onClick={() => setVisible(null)}
          className="touch-target rounded-md px-2 text-sm text-muted hover:bg-off"
          aria-label="Fermer le message"
        >
          ×
        </button>
      </div>
    </div>
  )
}
