import { Banner } from '@/components/ui/Banner'
import { PageShell } from '@/components/ui/PageShell'
import { requireUser } from '@/auth'
import { peutAdministrer } from '@/core/auth/roles'
import { getConnectionState } from '@/services/google/connect'
import { listOpenConflicts } from '@/services/sync/conflicts'
import { listFailedSyncRows, listPendingSyncRows } from '@/services/sync/queue'
import { SyncClient } from './SyncClient'

/**
 * L'écran de supervision : ce qui est connecté, ce qui a divergé, ce qui a
 * échoué. Il montre donc ce qui s'est passé, pas seulement ce qui attend —
 * une file qui perdrait ses échecs produirait un agenda silencieusement faux.
 */
export default async function AdminSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; tone?: string }>
}) {
  const user = await requireUser()
  const { message, tone } = await searchParams
  // Cet écran affichait tout retour de connexion Google de la même façon —
  // « Connexion Google annulée » avec l'apparence exacte de « Google Calendar
  // est connecté ». La tonalité voyage désormais avec le message ; une valeur
  // forgée ou absente retombe sur l'avertissement, jamais sur le succès : rien
  // ne doit pouvoir se faire passer pour une réussite.
  const toneMessage = tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : 'warning'

  // **L'écran reste ouvert à tous, la file d'instance non.**
  //
  // Cet écran porte deux choses de portées différentes : les divergences et
  // les échecs d'une personne — qui lui appartiennent —, et la file de
  // l'instance, qui porte le travail de tout le monde. L'arbitrage du porteur
  // du 20 août 2026 tient : « un CRA s'envoie par mission, pas par
  // consultant », donc la file **n'est jamais refiltrée par utilisateur**.
  // Elle est simplement montrée, ou pas.
  const administre = peutAdministrer(user.role)

  const [connection, conflicts, failures, pending] = await Promise.all([
    getConnectionState(user.id),
    listOpenConflicts(user.id),
    listFailedSyncRows(user.id),
    administre ? listPendingSyncRows() : Promise.resolve([]),
  ])

  return (
    <PageShell title="Administration · Synchronisation">
      {message !== undefined && (
        <div className="mb-6">
          <Banner tone={toneMessage}>{message}</Banner>
        </div>
      )}
      <SyncClient
        connection={connection}
        conflicts={conflicts}
        failures={failures}
        pending={pending}
      />
    </PageShell>
  )
}
