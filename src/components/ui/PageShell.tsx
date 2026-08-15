import type { ReactNode } from 'react'

export function PageShell({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl">{title}</h1>
        {actions}
      </div>
      {children}
    </main>
  )
}
