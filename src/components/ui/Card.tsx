import type { ReactNode } from 'react'

export function Card({
  title,
  children,
  className = '',
}: {
  title?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-lg border border-rule bg-surface p-4 shadow-card ${className}`}
    >
      {title !== undefined && <h2 className="mb-3 text-lg">{title}</h2>}
      {children}
    </section>
  )
}
