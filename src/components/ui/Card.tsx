import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

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
      className={cn(
        'rounded-lg border border-rule bg-surface p-4',
        // Trois couches d'ombre au repos, une élévation plus haute au survol :
        // c'est le passage de l'une à l'autre qui dit que la carte est un objet
        // posé sur la page, et non un cadre dessiné dessus.
        'shadow-card transition-shadow duration-150 hover:shadow-lift',
        className,
      )}
    >
      {title !== undefined && <h2 className="mb-3 text-xl">{title}</h2>}
      {children}
    </section>
  )
}
