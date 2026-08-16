import type { ReactNode } from 'react'
import Link from 'next/link'
import { requireUser, signOut } from '@/auth'
import { Button } from '@/components/ui/Button'

const LIENS = [
  { href: '/saisie', label: 'Saisie' },
  { href: '/charge', label: 'Charge' },
  { href: '/missions', label: 'Missions' },
  { href: '/cra', label: 'CRA' },
  { href: '/admin/saisie', label: 'Admin' },
  { href: '/admin/theme', label: 'Thème' },
  // La clé d'API Dolibarr se saisit sur cet écran, et nulle part ailleurs :
  // sans lien, le connecteur ne peut pas être configuré du tout.
  { href: '/admin/dolibarr', label: 'Dolibarr' },
  // Le client OAuth Google se saisit sur cet écran, et nulle part ailleurs :
  // il ne vit plus dans un fichier d'environnement, donc sans lien il n'y a
  // plus aucun moyen de configurer le connecteur.
  { href: '/admin/google', label: 'Google' },
  // Un écran de supervision qu'aucun lien n'atteint ne supervise rien.
  { href: '/admin/sync', label: 'Synchro' },
]

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser()

  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-surface">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <ul className="flex gap-4 text-sm font-medium">
            {LIENS.map((lien) => (
              <li key={lien.href}>
                <Link
                  href={lien.href}
                  className="touch-target inline-flex items-center px-2 text-ink hover:text-link hover:underline"
                >
                  {lien.label}
                </Link>
              </li>
            ))}
          </ul>
          <form action={handleSignOut}>
            <Button variant="secondary" type="submit">
              Se déconnecter
            </Button>
          </form>
        </nav>
      </header>
      {children}
    </div>
  )
}
