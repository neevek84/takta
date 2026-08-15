import type { ReactNode } from 'react'
import type { Tone } from './Badge'

type BannerTone = Exclude<Tone, 'neutral'>

const TONES: Record<BannerTone, string> = {
  success: 'border-success-edge bg-success text-success-ink',
  warning: 'border-warning-edge bg-warning text-warning-ink',
  danger: 'border-danger-edge bg-danger text-danger-ink',
  info: 'border-info-edge bg-info text-info-ink',
}

/**
 * Les quatre fonds d'état sont trop proches en luminance pour se distinguer
 * en niveaux de gris — `danger` et `info` sont à 0,0028 l'un de l'autre. La
 * teinte ne peut donc pas porter la tonalité seule : comme `Badge`, chaque
 * bandeau porte un glyphe qui lui est propre. L'appelant peut le remplacer,
 * jamais le supprimer.
 */
const GLYPHES: Record<BannerTone, string> = {
  success: '✓',
  warning: '▲',
  danger: '✕',
  info: 'ℹ',
}

export function Banner({
  tone,
  title,
  glyph,
  children,
}: {
  tone: BannerTone
  title?: string
  /** Remplace le glyphe par défaut de la tonalité ; il en reste toujours un. */
  glyph?: string
  children: ReactNode
}) {
  return (
    // `alert` interrompt, `status` attend le moment opportun : un dépassement
    // ou un refus doit être annoncé, une information non.
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={`flex gap-2 rounded-md border px-3 py-2 text-sm ${TONES[tone]}`}
    >
      {/* Masqué aux lecteurs d'écran : le `role` porte déjà la sémantique. */}
      <span aria-hidden="true" className="font-medium">
        {glyph ?? GLYPHES[tone]}
      </span>
      <div>
        {title !== undefined && <p className="font-medium">{title}</p>}
        {children}
      </div>
    </div>
  )
}
