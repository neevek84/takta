import { accesAdministration } from '@/auth'
import { AccesRefuse } from '@/components/ui/AccesRefuse'
import { inventaire } from '@/services/archivage'
import { PageShell } from '@/components/ui/PageShell'
import { GestionDonnees } from './GestionDonnees'

/**
 * L'écran qui montre ce que les autres cachent : clients archivés, missions
 * rangées, et ce qu'une suppression emporterait.
 *
 * Sans lui, archiver reviendrait à perdre — une mission archivée n'apparaît
 * plus nulle part, par construction.
 */
export default async function AdminDonneesPage() {
  // Le verdict **avant** tout service : rien de ce que cette page allait
  // lire n'est lu si l'accès est refusé.
  const { autorise, user } = await accesAdministration()
  if (!autorise) return <AccesRefuse role={user.role} />
  const etat = await inventaire()

  return (
    <PageShell title="Données">
      <GestionDonnees inventaire={etat} />
    </PageShell>
  )
}
