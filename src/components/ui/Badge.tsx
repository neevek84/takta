import type { ReactNode } from 'react'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONES: Record<Tone, string> = {
  neutral: 'border-rule bg-off text-ink',
  success: 'border-success-edge bg-success text-success-ink',
  warning: 'border-warning-edge bg-warning text-warning-ink',
  danger: 'border-danger-edge bg-danger text-danger-ink',
  info: 'border-info-edge bg-info text-info-ink',
}

/**
 * Le glyphe n'est pas une décoration : c'est lui qui distingue les états
 * quand la teinte n'est pas perçue. Il est masqué aux lecteurs d'écran, qui
 * lisent déjà le libellé.
 */
export function Badge({
  tone,
  glyph,
  children,
  testId,
}: {
  tone: Tone
  glyph: string
  children: ReactNode
  testId?: string
}) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      <span aria-hidden="true">{glyph}</span>
      {children}
    </span>
  )
}
