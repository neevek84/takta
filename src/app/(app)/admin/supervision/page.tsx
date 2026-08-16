import Link from 'next/link'
import { requireUser } from '@/auth'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import { Field } from '@/components/ui/Field'
import { PageShell } from '@/components/ui/PageShell'
import { Select } from '@/components/ui/Select'
import { AUDIT_ACTIONS, isAuditAction } from '@/core/audit/events'
import { listAuditEvents } from '@/services/audit'
import { listJobs } from '@/services/jobs/scheduler'
import { listAlertes, readOrdonnanceur } from '@/services/supervision'
import { AlertesPanel } from './AlertesPanel'
import { TravauxPanel } from './TravauxPanel'

export const dynamic = 'force-dynamic'

/**
 * Un seul écran, dans cet ordre : ce qui demande une action, puis l'état des
 * travaux, puis l'historique. L'inverse obligerait à faire défiler pour
 * découvrir qu'un abonnement est mort depuis trois jours.
 */
export default async function SupervisionPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; du?: string; au?: string; message?: string; tone?: string }>
}) {
  const user = await requireUser()
  const filtres = await searchParams

  // La tonalité voyage avec le message. Une valeur forgée ou absente retombe
  // sur l'avertissement, jamais sur le succès : rien ne doit pouvoir se faire
  // passer pour une réussite.
  const toneMessage =
    filtres.tone === 'success' ? 'success' : filtres.tone === 'danger' ? 'danger' : 'warning'

  const action =
    filtres.action !== undefined && isAuditAction(filtres.action) ? filtres.action : undefined

  const [alertes, ordonnanceur, travaux, journal] = await Promise.all([
    listAlertes(user.id),
    readOrdonnanceur(user.id),
    listJobs(),
    listAuditEvents(user.id, {
      ...(action !== undefined && { action }),
      ...(filtres.du !== undefined && { du: filtres.du }),
      ...(filtres.au !== undefined && { au: filtres.au }),
      limit: 100,
    }),
  ])

  return (
    <PageShell title="Supervision">
      <div className="flex flex-col gap-6">
        {filtres.message !== undefined && (
          <Banner tone={toneMessage}>{filtres.message}</Banner>
        )}

        <AlertesPanel alertes={alertes} />
        <TravauxPanel travaux={travaux} ordonnanceur={ordonnanceur} />

        <Card title="Journal">
          {/* Filtre en GET : l'URL devient partageable, et le retour arrière
              du navigateur retrouve la vue précédente. */}
          <form method="get" className="mb-3 flex flex-wrap items-end gap-3">
            <Select label="Événement" name="action" defaultValue={action ?? ''}>
              <option value="">Tous</option>
              {AUDIT_ACTIONS.map((nom) => (
                <option key={nom} value={nom}>{nom}</option>
              ))}
            </Select>
            <Field label="Du" type="date" name="du" defaultValue={filtres.du ?? ''} />
            <Field label="Au" type="date" name="au" defaultValue={filtres.au ?? ''} />
            <Button type="submit" variant="secondary">Filtrer</Button>
          </form>

          {journal.length === 0 ? (
            <p className="text-sm text-muted">Aucune entrée pour ce filtre.</p>
          ) : (
            <DataTable caption="Entrées du journal de preuve">
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-left">N°</th>
                  <th scope="col" className="p-2 text-left">Quand</th>
                  <th scope="col" className="p-2 text-left">Qui</th>
                  <th scope="col" className="p-2 text-left">Quoi</th>
                  <th scope="col" className="p-2 text-left">Cible</th>
                  <th scope="col" className="p-2 text-left">Détail</th>
                </tr>
              </thead>
              <tbody>
                {journal.map((entree) => (
                  <tr key={entree.seq} className="border-t border-rule align-top">
                    <td className="p-2 tabular-nums">{entree.seq}</td>
                    <td className="p-2">{entree.occurredAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                    <td className="p-2">{entree.actorLabel}</td>
                    <td className="p-2 font-medium">{entree.action}</td>
                    <td className="p-2">{entree.entityType} {entree.entityId}</td>
                    <td className="p-2">
                      {/* La charge utile est rédigée **à l'écriture** : ce qui
                          s'affiche ici ne peut plus contenir de secret. */}
                      <code className="text-xs">{JSON.stringify(entree.payload)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>

        <Card title="Ailleurs">
          <p className="text-sm text-muted">
            La file de synchronisation, les divergences d’agenda et les connexions se
            supervisent sur l’écran{' '}
            <Link href="/admin/sync" className="text-link underline">
              Synchronisation
            </Link>{' '}
            — cet écran-ci ne les redouble pas. Les abonnements sortants et leurs livraisons
            se règlent sur{' '}
            <Link href="/admin/webhooks" className="text-link underline">
              Abonnements
            </Link>
            .
          </p>
        </Card>
      </div>
    </PageShell>
  )
}
