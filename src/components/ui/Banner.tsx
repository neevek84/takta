import type { ReactNode } from 'react'
import type { Tone } from './Badge'

const TONES: Record<Exclude<Tone, 'neutral'>, string> = {
  success: 'border-success-edge bg-success text-success-ink',
  warning: 'border-warning-edge bg-warning text-warning-ink',
  danger: 'border-danger-edge bg-danger text-danger-ink',
  info: 'border-info-edge bg-info text-info-ink',
}

export function Banner({
  tone,
  title,
  children,
}: {
  tone: Exclude<Tone, 'neutral'>
  title?: string
  children: ReactNode
}) {
  return (
    // `alert` interrompt, `status` attend le moment opportun : un dépassement
    // ou un refus doit être annoncé, une information non.
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={`rounded-md border px-3 py-2 text-sm ${TONES[tone]}`}
    >
      {title !== undefined && <p className="font-medium">{title}</p>}
      {children}
    </div>
  )
}
