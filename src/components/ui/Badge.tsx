import type { ReactNode } from 'react'
import type { Icone } from './icons'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<Tone, string> = {
  neutral: 'border-rule bg-off text-ink',
  success: 'border-success-edge bg-success text-success-ink',
  warning: 'border-warning-edge bg-warning text-warning-ink',
  danger: 'border-danger-edge bg-danger text-danger-ink',
  info: 'border-info-edge bg-info text-info-ink',
}

/**
 * L'icône n'est pas une décoration : c'est elle qui distingue les états quand
 * la teinte n'est pas perçue. Elle est masquée aux lecteurs d'écran, qui
 * lisent déjà le libellé.
 *
 * Elle reste **obligatoire** : l'appelant choisit laquelle, il ne peut pas
 * s'en passer. C'est le contrat que portait la prop `glyph` avant que les
 * caractères de la police système ne deviennent des tracés.
 */
export function Badge({
  tone,
  icone: Glyphe,
  children,
  testId,
}: {
  tone: Tone
  icone: Icone
  children: ReactNode
  testId?: string
}) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      <Glyphe className="shrink-0" />
      {children}
    </span>
  )
}
