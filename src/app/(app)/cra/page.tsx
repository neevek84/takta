import { requireUser } from '@/auth'
import { listCras } from '@/services/cra'
import { listMissionsForUser } from '@/services/missions'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import { StatusBadge } from '@/components/cra/StatusBadge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PageShell } from '@/components/ui/PageShell'
import { Select } from '@/components/ui/Select'
import { openCra, moveCra, saveTracking } from './actions'

const LABELS: Record<CraTransition, string> = {
  ENVOYER: 'Marquer envoyé',
  VALIDER: 'Marquer validé',
  REFUSER: 'Marquer refusé',
  ROUVRIR: 'Rouvrir',
}

const ALL: CraTransition[] = ['ENVOYER', 'VALIDER', 'REFUSER', 'ROUVRIR']

export default async function CraPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const user = await requireUser()
  const { month: raw } = await searchParams
  const month = raw ?? new Date().toISOString().slice(0, 7)

  const cras = await listCras(user.id, month)
  const missions = await listMissionsForUser(user.id)

  return (
    <PageShell title={`CRA · ${month}`}>
      <form action={openCra} className="mb-8 flex flex-wrap items-end gap-2">
        <input type="hidden" name="month" value={month} />
        <Select label="Mission" name="missionId" required>
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.clientName} · {m.label}
            </option>
          ))}
        </Select>
        <Button variant="primary">Ouvrir un CRA</Button>
      </form>

      {cras.map((cra) => (
        <Card key={cra.id} className="mb-6">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-lg">
              {cra.clientName} · {cra.missionLabel}
            </h2>
            <StatusBadge status={cra.status} />
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {ALL.filter((t) => canTransition(cra.status, t)).map((t) => (
              <form key={t} action={moveCra}>
                <input type="hidden" name="craId" value={cra.id} />
                <input type="hidden" name="transition" value={t} />
                <Button variant={t === 'REFUSER' ? 'danger' : 'secondary'}>{LABELS[t]}</Button>
              </form>
            ))}
          </div>

          <form action={saveTracking} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="craId" value={cra.id} />
            <Field label="N° de facture" name="invoiceNumber" defaultValue={cra.invoiceNumber ?? ''} />
            <Field
              label="Facturé le"
              name="invoicedAt"
              type="date"
              defaultValue={cra.invoicedAt?.toISOString().slice(0, 10) ?? ''}
            />
            <Field
              label="Payé le"
              name="paidAt"
              type="date"
              defaultValue={cra.paidAt?.toISOString().slice(0, 10) ?? ''}
            />
            <Button>Enregistrer le suivi</Button>
          </form>
          <p className="mt-2 text-xs text-muted">
            Champs de suivi uniquement — l’application ne produit aucune facture.
          </p>
        </Card>
      ))}

      {cras.length === 0 && <p className="text-muted">Aucun CRA ouvert sur ce mois.</p>}
    </PageShell>
  )
}
