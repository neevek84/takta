'use client'

import { useId, type InputHTMLAttributes } from 'react'

export function Checkbox({
  label,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId()

  return (
    // La cible tactile est portée par le libellé : cocher une case de 16 px
    // au doigt est une loterie, cliquer un libellé de 44 points ne l'est pas.
    <label
      htmlFor={id}
      className={`touch-target inline-flex items-center gap-2 text-sm text-ink ${className}`}
    >
      <input
        {...rest}
        id={id}
        type="checkbox"
        className="h-4 w-4 rounded-sm border border-rule accent-accent"
      />
      {label}
    </label>
  )
}
