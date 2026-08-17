import type { ReactNode } from 'react'
import { requireUser, signOut } from '@/auth'
import { NavRail } from '@/components/nav/NavRail'

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser()

  async function handleSignOut() {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  return (
    // Le rail est un composant client — il lit la route courante et replie son
    // groupe de réglages. Le layout reste serveur et ne lui passe que l'action
    // de déconnexion, qui doit s'exécuter côté serveur.
    <div className="min-h-screen md:flex">
      <NavRail onSignOut={handleSignOut} />
      {/* `pb-20` réserve la hauteur de la barre basse sur téléphone : sans
          elle, la barre recouvre le bas du contenu, et la dernière ligne d'un
          tableau devient illisible. */}
      <div className="min-w-0 flex-1 pb-20 md:pb-0">{children}</div>
    </div>
  )
}
