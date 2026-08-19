import { requireUser } from '@/auth'
import { listClients } from '@/services/clients'
import { listMissionsForUser } from '@/services/missions'
import { getSettings } from '@/services/settings'
import { getDolibarrApi } from '@/services/dolibarr/resolve'
import {
  listerCommandesRattachables,
  listerProjetsCandidats,
  type ProjetCandidat,
} from '@/services/dolibarr/commande'
import { Banner } from '@/components/ui/Banner'
import { PageShell } from '@/components/ui/PageShell'
import { MissionsExplorer, type CommandeOuverte } from './MissionsExplorer'

export default async function MissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; tone?: string }>
}) {
  const user = await requireUser()
  const { message, tone } = await searchParams
  // Une tonalité forgée ou absente retombe sur « success », comme sur l'écran
  // d'administration : ce canal ne porte pas toujours de tonalité explicite.
  const toneMessage = tone === 'danger' ? 'danger' : 'success'
  const [clients, missions, settings, api] = await Promise.all([
    listClients(user.id),
    listMissionsForUser(user.id),
    getSettings(),
    getDolibarrApi(),
  ])

  // Dolibarr est facultatif, et une instance en panne ne doit pas emporter la
  // page : la création manuelle des missions n'en dépend pas.
  let commandes: CommandeOuverte[] = []
  let projets: ProjetCandidat[] = []
  let panneDolibarr: string | null = null
  if (api !== null) {
    try {
      commandes = await listerCommandesRattachables({ userId: user.id, api })
      projets = await listerProjetsCandidats(api)
    } catch (err) {
      panneDolibarr = err instanceof Error ? err.message : String(err)
    }
  }

  return (
    <PageShell title="Missions">
      {message !== undefined && (
        <div className="mb-6">
          <Banner tone={toneMessage}>{message}</Banner>
        </div>
      )}

      <MissionsExplorer
        missions={missions}
        clients={clients}
        heuresParJourDefaut={settings.minutesParJour / 60}
        commandes={commandes}
        projets={projets}
        dolibarrActif={api !== null}
        panneDolibarr={panneDolibarr}
      />
    </PageShell>
  )
}
