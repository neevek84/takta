import type { ReactNode } from 'react'

/** Tableau dense : la grille de saisie et le plan de charge lisent des chiffres,
 *  pas de la prose. Le défilement horizontal est porté par l'enveloppe. */
export function DataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm text-ink">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  )
}
