'use client'

import { useId, type InputHTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

export function Field({
  label,
  error,
  hint,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  error?: string
  hint?: string
}) {
  const id = useId()
  const errorId = `${id}-erreur`
  const hintId = `${id}-aide`

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="text-ink">
        {label}
      </label>
      <input
        {...rest}
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error !== undefined ? errorId : hint !== undefined ? hintId : undefined}
        className={cn(
          'touch-target rounded-md border bg-surface px-3 text-ink',
          'transition-colors duration-150',
          'border-rule',
          // `cn()` fait tomber `border-rule` : la bordure d'erreur l'emporte
          // par la composition, plus par l'ordre d'insertion des règles CSS.
          error !== undefined && 'border-danger-edge',
          className,
        )}
      />
      {hint !== undefined && error === undefined && (
        <span id={hintId} className="text-xs text-muted">
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span id={errorId} className="text-xs text-danger-ink">
          {error}
        </span>
      )}
    </div>
  )
}
