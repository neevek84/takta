'use client'

import { useState } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import type { ConflictResolution } from '@/core/sync/policy'
import type { OpenConflict } from '@/services/sync/conflicts'
import type { FailedSyncRow } from '@/services/sync/queue'
import type { FlushReport } from '@/services/sync/flush'
import { arbitrer, rejouer, revoquerGoogle, synchroniserMaintenant } from './actions'

const ISSUES: Array<{ resolution: ConflictResolution; label: string }> = [
  { resolution: 'RETABLIR', label: 'Rétablir' },
  { resolution: 'ACCEPTER', label: 'Accepter' },
  { resolution: 'DETACHER', label: 'Détacher' },
]

const KIND_LABELS: Record<string, string> = {
  REMOTE_MODIFIED: "L'événement a été modifié dans l'agenda",
  REMOTE_DELETED: "L'événement a été supprimé de l'agenda",
}

function compteRendu(r: FlushReport): string {
  return r.nonConnecte
    ? 'Aucun agenda joignable. La saisie continue de fonctionner normalement.'
    : `${r.traitees} élément(s) traité(s) : ${r.reussies} synchronisé(s), ${r.conflits} divergence(s), ${r.echecs} échec(s).`
}

export function SyncClient(props: {
  connection: { connected: boolean; calendarId: string; scope: string; connectedAt: Date | null }
  conflicts: OpenConflict[]
  failures: FailedSyncRow[]
}) {
  const [info, setInfo] = useState<string | null>(null)
  const [refus, setRefus] = useState<string | null>(null)
  const [enCours, setEnCours] = useState(false)

  async function onArbitrer(id: string, resolution: ConflictResolution): Promise<void> {
    const r = await arbitrer(id, resolution)
    // Si la règle refuse, le conflit reste ouvert et le motif est affiché :
    // un arbitrage silencieusement sans effet serait pire que pas d'arbitrage.
    setRefus(r.ok ? null : r.message)
    setInfo(r.ok ? 'Divergence arbitrée.' : null)
  }

  async function onSynchroniser(): Promise<void> {
    setRefus(null)
    setEnCours(true)
    try {
      setInfo(compteRendu(await synchroniserMaintenant()))
    } finally {
      // Un second déclenchement pendant le premier repousserait les mêmes
      // lignes deux fois ; le bouton reste rendu, simplement inactif.
      setEnCours(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* `Banner` porte le rôle : `status` attend son tour, `alert` interrompt. */}
      {info !== null && <Banner tone="info">{info}</Banner>}
      {refus !== null && (
        <Banner tone="warning" title="Arbitrage refusé">
          {refus}
        </Banner>
      )}

      <Card title="Connexion">
        {props.connection.connected ? (
          <div className="flex flex-col items-start gap-3 text-sm">
            <p>
              Connecté. Calendrier dédié : <code>{props.connection.calendarId}</code>
            </p>
            <form action={revoquerGoogle}>
              <Button type="submit">Révoquer la connexion</Button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3 text-sm">
            <p className="text-muted">
              Aucun agenda connecté. La saisie fonctionne normalement ; rien n’est poussé.
            </p>
            <a
              href="/api/google/connect"
              className="touch-target inline-flex items-center rounded-md border border-rule px-4 text-sm font-medium text-link hover:bg-off"
            >
              Connecter Google Calendar
            </a>
          </div>
        )}
      </Card>

      <Card title="Synchronisation">
        <div className="flex flex-col items-start gap-3 text-sm">
          <p className="text-muted">
            Le drainage part aussi tout seul, à chaque déclenchement périodique. Ce bouton ne fait
            que l’avancer.
          </p>
          <Button variant="primary" loading={enCours} onClick={() => void onSynchroniser()}>
            Synchroniser maintenant
          </Button>
        </div>
      </Card>

      <Card title="Divergences">
        {props.conflicts.length === 0 ? (
          <p className="text-sm text-muted">Aucune divergence à arbitrer.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {props.conflicts.map((c) => (
              <li key={c.id} className="rounded-md border border-rule p-3 text-sm">
                <p className="font-medium">{c.libelle}</p>
                <p className="text-muted">{KIND_LABELS[c.kind] ?? c.kind}</p>
                {c.remote !== null && (
                  <p className="text-muted">
                    Agenda : « {c.remote.summary} » {c.remote.startLocal} → {c.remote.endLocal}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {ISSUES.map((i) => (
                    <Button key={i.resolution} onClick={() => void onArbitrer(c.id, i.resolution)}>
                      {i.label}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Échecs">
        {props.failures.length === 0 ? (
          <p className="text-sm text-muted">Aucun échec en attente.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {props.failures.map((f) => (
              <li key={f.id} className="rounded-md border border-rule p-3 text-sm">
                <p className="font-medium">{f.libelle}</p>
                <p className="text-muted">
                  {f.operation} · {f.attempts} tentative(s) · {f.lastError}
                </p>
                <Button
                  className="mt-2"
                  onClick={async () => {
                    await rejouer(f.id)
                    setInfo('Ligne remise en file.')
                  }}
                >
                  Rejouer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
