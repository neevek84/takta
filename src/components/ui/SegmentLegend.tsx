import { cn } from '@/lib/cn'

/**
 * Habillage des deux segments que l'application dessine partout : le réalisé,
 * plein et froid, et le prévisionnel, ambre et tireté.
 *
 * Les trois constantes sont exportées pour que les pastilles de la légende
 * soient **les mêmes classes** que les segments qu'elles nomment : une légende
 * qui dériverait de la barre serait pire qu'aucune légende.
 */
export const SEGMENT_REALISE = 'bg-accent'

/**
 * Une teinte opaque, et non plus `bg-accent/45 pattern-hatch`.
 *
 * L'opacité était un angle mort documenté du contrôle de contraste — 1,32:1
 * sur sa piste, que le calcul ne voit pas puisqu'il ne connaît pas ce qu'il y
 * a dessous. Une teinte opaque, elle, entre dans `TEXT_PAIRS`.
 */
export const SEGMENT_PREVU = 'bg-prevu'

/**
 * Le marqueur non chromatique du prévisionnel : le tireté remplace la hachure.
 *
 * Sans lui, deux teintes opaques ne se distingueraient plus en vision
 * monochrome — et l'information reposerait sur la seule couleur, ce que le
 * projet interdit. Séparé de la teinte parce qu'un segment de largeur nulle ne
 * doit pas laisser un liseré derrière lui : il annoncerait un prévisionnel qui
 * n'existe pas.
 */
export const SEGMENT_PREVU_BORDURE = 'border border-dashed border-prevu-edge'

/**
 * Un `title` sur un `<div>` non focalisable n'apparaît qu'au survol de la
 * souris : jamais au clavier, jamais au tactile, et il n'est pas annoncé par
 * les lecteurs d'écran. Le nom des segments doit donc être écrit à l'écran.
 */
export function SegmentLegend({ className = '' }: { className?: string }) {
  return (
    <p
      data-testid="legende-segments"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden="true"
          className={cn('inline-block h-2 w-4 rounded-sm border border-rule', SEGMENT_REALISE)}
        />
        Réalisé
      </span>
      <span className="inline-flex items-center gap-1">
        {/* Pas de `border-rule` ici : la bordure de la pastille **est** le
            tireté du segment, et deux bordures ne se superposent pas. */}
        <span
          aria-hidden="true"
          className={cn('inline-block h-2 w-4 rounded-sm', SEGMENT_PREVU, SEGMENT_PREVU_BORDURE)}
        />
        Prévisionnel
      </span>
    </p>
  )
}
