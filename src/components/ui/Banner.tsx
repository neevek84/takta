import type { ReactNode } from 'react'
import type { Tone } from './Badge'
import {
  IconeAvertissement,
  IconeDanger,
  IconeInfo,
  IconeSucces,
  type Icone,
} from './icons'

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
 * bandeau porte une icône qui lui est propre. L'appelant peut la remplacer,
 * jamais la supprimer.
 */
const ICONES: Record<BannerTone, Icone> = {
  success: IconeSucces,
  warning: IconeAvertissement,
  danger: IconeDanger,
  info: IconeInfo,
}

export function Banner({
  tone,
  title,
  icone,
  children,
}: {
  tone: BannerTone
  title?: string
  /** Remplace l'icône par défaut de la tonalité ; il en reste toujours une. */
  icone?: Icone
  children: ReactNode
}) {
  const Glyphe = icone ?? ICONES[tone]
  return (
    // `alert` interrompt, `status` attend le moment opportun : un dépassement
    // ou un refus doit être annoncé, une information non.
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={`flex gap-2 rounded-md border px-3 py-2 text-sm ${TONES[tone]}`}
    >
      {/* Masqué aux lecteurs d'écran par l'icône elle-même : le `role` porte
          déjà la sémantique. Le `mt-0.5` la pose sur la ligne de base de la
          première ligne de texte, que le tracé ne connaît pas. */}
      <Glyphe className="mt-0.5 shrink-0" />
      <div>
        {title !== undefined && <p className="font-medium">{title}</p>}
        {children}
      </div>
    </div>
  )
}
