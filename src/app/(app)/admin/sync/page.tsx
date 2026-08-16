import { Banner } from '@/components/ui/Banner'
import { PageShell } from '@/components/ui/PageShell'
import { requireUser } from '@/auth'
import { getConnectionState } from '@/services/google/connect'
import { listOpenConflicts } from '@/services/sync/conflicts'
import { listFailedSyncRows } from '@/services/sync/queue'
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

  const [connection, conflicts, failures] = await Promise.all([
    getConnectionState(user.id),
    listOpenConflicts(user.id),
    listFailedSyncRows(user.id),
  ])

  return (
    <PageShell title="Administration · Synchronisation">
      {message !== undefined && (
        <div className="mb-6">
          <Banner tone={toneMessage}>{message}</Banner>
        </div>
      )}
      <SyncClient connection={connection} conflicts={conflicts} failures={failures} />
    </PageShell>
  )
}
