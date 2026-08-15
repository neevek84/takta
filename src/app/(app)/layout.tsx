import type { ReactNode } from 'react'
import Link from 'next/link'
import { requireUser, signOut } from '@/auth'

const LIENS = [
  { href: '/saisie', label: 'Saisie' },
  { href: '/missions', label: 'Missions' },
  { href: '/cra', label: 'CRA' },
  { href: '/admin/saisie', label: 'Admin' },
]

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser()

  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-slate-50">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <ul className="flex gap-4 text-sm font-medium">
            {LIENS.map((lien) => (
              <li key={lien.href}>
                <Link href={lien.href} className="text-slate-700 hover:text-slate-900 hover:underline">
                  {lien.label}
                </Link>
              </li>
            ))}
          </ul>
          <form action={handleSignOut}>
            <button
              type="submit"
              className="rounded border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100"
            >
              Se déconnecter
            </button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  )
}
