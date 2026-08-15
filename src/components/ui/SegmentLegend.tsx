/**
 * Habillage des deux segments que l'application dessine partout : le réalisé,
 * plein, et le prévisionnel, hachuré et atténué.
 *
 * Les deux constantes sont exportées pour que les pastilles de la légende
 * soient **les mêmes classes** que les segments qu'elles nomment : une légende
 * qui dériverait de la barre serait pire qu'aucune légende.
 */
export const SEGMENT_REALISE = 'bg-accent'
export const SEGMENT_PREVU = 'bg-accent/45 pattern-hatch'

/**
 * Un `title` sur un `<div>` non focalisable n'apparaît qu'au survol de la
 * souris : jamais au clavier, jamais au tactile, et il n'est pas annoncé par
 * les lecteurs d'écran. Le nom des segments doit donc être écrit à l'écran.
 */
export function SegmentLegend({ className = '' }: { className?: string }) {
  return (
    <p
      data-testid="legende-segments"
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-4 rounded-sm border border-rule ${SEGMENT_REALISE}`}
        />
        Réalisé
      </span>
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-4 rounded-sm border border-rule ${SEGMENT_PREVU}`}
        />
        Prévisionnel
      </span>
    </p>
  )
}
