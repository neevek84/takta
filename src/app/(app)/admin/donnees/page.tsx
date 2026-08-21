import { requireUser } from '@/auth'
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
  await requireUser()
  const etat = await inventaire()

  return (
    <PageShell title="Données">
      <GestionDonnees inventaire={etat} />
    </PageShell>
  )
}
