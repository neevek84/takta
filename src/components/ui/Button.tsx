'use client'

import type { ButtonHTMLAttributes, Ref } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'

/**
 * Le survol du bouton plein **inverse** le bouton au lieu d'assombrir l'or :
 * l'or assombri ne porte plus son encre à 4,5:1 (4,24), l'inversion tient à
 * 14,53. Un survol lisible, et perceptible sans distinguer les teintes.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-ink-deep hover:text-on-dark',
  secondary: 'border border-rule bg-surface text-ink hover:bg-off',
  quiet: 'text-link hover:bg-off',
  danger: 'border border-danger-edge bg-danger text-danger-ink hover:bg-danger-edge',
}

export function Button({
  variant = 'secondary',
  loading = false,
  disabled,
  children,
  className = '',
  ref,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  loading?: boolean
  /** React 19 transmet `ref` comme une prop ordinaire ; `ConfirmDialog` en a
   *  besoin pour donner le focus au bouton de confirmation à l'ouverture. */
  ref?: Ref<HTMLButtonElement>
}) {
  return (
    <button
      {...rest}
      ref={ref}
      disabled={disabled === true || loading}
      // Hors chargement l'attribut n'a rien à dire : `aria-busy="false"` sur
      // chaque bouton de l'application est du bruit pour rien.
      aria-busy={loading || undefined}
      className={`touch-target inline-flex items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
    >
      {/* L'état de chargement se lit dans le texte, pas seulement dans une
          teinte atténuée : l'atténuation seule n'est pas perceptible par tous. */}
      {loading ? <>{children}…</> : children}
    </button>
  )
}
