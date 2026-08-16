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
  searchParams: Promise<{ message?: string }>
}) {
  const user = await requireUser()
  const { message } = await searchParams

  const [connection, conflicts, failures] = await Promise.all([
    getConnectionState(user.id),
    listOpenConflicts(user.id),
    listFailedSyncRows(user.id),
  ])

  return (
    <PageShell title="Administration · Synchronisation">
      {message !== undefined && (
        <p
          role="status"
          className="mb-6 rounded-md border border-info-edge bg-info px-3 py-2 text-sm text-info-ink"
        >
          {message}
        </p>
      )}
      <SyncClient connection={connection} conflicts={conflicts} failures={failures} />
    </PageShell>
  )
}
