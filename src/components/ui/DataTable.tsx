import type { ReactNode } from 'react'

/** Tableau dense : la grille de saisie et le plan de charge lisent des chiffres,
 *  pas de la prose. Le défilement horizontal est porté par l'enveloppe.
 *
 *  `tabular-nums` donne aux chiffres une chasse fixe : sans elle, « 11 » et
 *  « 100 » ne s'alignent pas d'une ligne à l'autre, dans une application dont
 *  chaque écran est une colonne de nombres. */
export function DataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm text-ink tabular-nums">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  )
}
