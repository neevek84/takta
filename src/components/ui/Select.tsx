'use client'

import { useId, type SelectHTMLAttributes } from 'react'

export function Select({
  label,
  error,
  children,
  className = '',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  const id = useId()
  const errorId = `${id}-erreur`

  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="text-ink">
        {label}
      </label>
      <select
        {...rest}
        id={id}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        className={`touch-target rounded-md border bg-surface px-3 text-ink ${
          error === undefined ? 'border-rule' : 'border-danger-edge'
        } ${className}`}
      >
        {children}
      </select>
      {error !== undefined && (
        <span id={errorId} className="text-xs text-danger-ink">
          {error}
        </span>
      )}
    </div>
  )
}
