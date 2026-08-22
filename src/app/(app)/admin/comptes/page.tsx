import { accesAdministration } from '@/auth'
import { AccesRefuse } from '@/components/ui/AccesRefuse'
import { PageShell } from '@/components/ui/PageShell'
import { listerComptes } from '@/services/auth/comptes'
import { GestionComptes } from './GestionComptes'

export default async function AdminComptesPage() {
  const { autorise, user } = await accesAdministration()
  if (!autorise) return <AccesRefuse role={user.role} />

  const comptes = await listerComptes()

  return (
    <PageShell title="Administration · Comptes">
      <GestionComptes comptes={comptes} />
    </PageShell>
  )
}
