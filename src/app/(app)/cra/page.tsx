import { requireUser } from '@/auth'
import { listCras } from '@/services/cra'
import { listMissionsForUser } from '@/services/missions'
import { previewCraInvoice } from '@/services/dolibarr/invoicing'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
import type { InvoiceDraft } from '@/core/dolibarr/invoice'
import { StatusBadge } from '@/components/cra/StatusBadge'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { PageShell } from '@/components/ui/PageShell'
import { Select } from '@/components/ui/Select'
import { openCra, moveCra, saveTracking, demanderFacture } from './actions'

const LABELS: Record<CraTransition, string> = {
  ENVOYER: 'Marquer envoyé',
  VALIDER: 'Marquer validé',
  REFUSER: 'Marquer refusé',
  ROUVRIR: 'Rouvrir',
}

const ALL: CraTransition[] = ['ENVOYER', 'VALIDER', 'REFUSER', 'ROUVRIR']

/** Tonalités admises dans l'URL ; toute autre valeur retombe sur l'information. */
const TONES = ['success', 'info', 'danger'] as const
type Tone = (typeof TONES)[number]

function toTone(brut: string | undefined): Tone {
  return TONES.includes(brut as Tone) ? (brut as Tone) : 'info'
}

function jours(centiemes: number): string {
  return (centiemes / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })
}

function euros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 })
}

export default async function CraPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; message?: string; tone?: string }>
}) {
  const user = await requireUser()
  const { month: raw, message, tone } = await searchParams
  const month = raw ?? new Date().toISOString().slice(0, 7)

  const cras = await listCras(user.id, month)
  const missions = await listMissionsForUser(user.id)

  // Ce que Dolibarr serait prié de facturer, CRA validé par CRA validé. Vide
  // quand Dolibarr n'est pas connecté : le service le garantit, et l'écran ne
  // propose alors rien du tout.
  const propositions: Record<string, InvoiceDraft> = {}
  for (const cra of cras) {
    if (cra.status !== 'VALIDE') continue
    const draft = await previewCraInvoice({ userId: user.id, craId: cra.id })
    if (draft !== null) propositions[cra.id] = draft
  }

  return (
    <PageShell title={`CRA · ${month}`}>
      {message !== undefined && message !== '' && (
        <div className="mb-6">
          <Banner tone={toTone(tone)}>{message}</Banner>
        </div>
      )}

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

          {propositions[cra.id] !== undefined && (
            <section className="mt-4 rounded-md border border-rule bg-off p-3 text-sm">
              <h3 className="mb-1 font-medium">Facturation</h3>
              <ul className="mb-2 list-disc pl-5">
                {propositions[cra.id]!.lines.map((l) => (
                  <li key={l.lineId}>
                    {l.label} — {jours(l.qteCentiemes)} jour(s) × {euros(l.tjmCents)} €
                  </li>
                ))}
              </ul>
              <p className="mb-2">Total hors taxes : {euros(propositions[cra.id]!.totalHtCents)} €</p>

              <form action={demanderFacture}>
                <input type="hidden" name="craId" value={cra.id} />
                <input type="hidden" name="month" value={month} />
                <Button variant="secondary">Demander la facture à Dolibarr (brouillon)</Button>
              </form>

              <p className="mt-2 text-xs text-muted">
                Dolibarr facture, pas cette application : elle ne numérote rien, ne calcule aucune
                TVA et n’émet aucun document. La facture est créée au brouillon, à vérifier et à
                valider dans Dolibarr. Décliner n’a aucune conséquence.
              </p>
            </section>
          )}
        </Card>
      ))}

      {cras.length === 0 && <p className="text-muted">Aucun CRA ouvert sur ce mois.</p>}
    </PageShell>
  )
}
