import { requireUser } from '@/auth'
import { prisma } from '@/db/client'
import { listCras } from '@/services/cra'
import { canTransition, type CraTransition } from '@/core/cra/state-machine'
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
  const missions = await prisma.mission.findMany({
    where: { archived: false },
    include: { client: true },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">CRA · {month}</h1>

      <form action={openCra} className="mb-8 flex items-end gap-2">
        <input type="hidden" name="month" value={month} />
        <select name="missionId" required className="rounded border px-2 py-1">
          {missions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.client.name} · {m.label}
            </option>
          ))}
        </select>
        <button className="rounded bg-slate-900 px-3 py-1 text-white">Ouvrir un CRA</button>
      </form>

      {cras.map((cra) => (
        <section key={cra.id} className="mb-6 rounded border p-4">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="font-medium">
              {cra.clientName} · {cra.missionLabel}
            </h2>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{cra.status}</span>
          </div>

          <div className="mb-4 flex gap-2">
            {ALL.filter((t) => canTransition(cra.status, t)).map((t) => (
              <form key={t} action={moveCra}>
                <input type="hidden" name="craId" value={cra.id} />
                <input type="hidden" name="transition" value={t} />
                <button className="rounded border px-3 py-1 text-sm">{LABELS[t]}</button>
              </form>
            ))}
          </div>

          <form action={saveTracking} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="craId" value={cra.id} />
            <label className="flex flex-col text-sm">
              N° de facture
              <input
                name="invoiceNumber"
                defaultValue={cra.invoiceNumber ?? ''}
                className="rounded border px-2 py-1"
              />
            </label>
            <label className="flex flex-col text-sm">
              Facturé le
              <input
                name="invoicedAt"
                type="date"
                defaultValue={cra.invoicedAt?.toISOString().slice(0, 10) ?? ''}
                className="rounded border px-2 py-1"
              />
            </label>
            <label className="flex flex-col text-sm">
              Payé le
              <input
                name="paidAt"
                type="date"
                defaultValue={cra.paidAt?.toISOString().slice(0, 10) ?? ''}
                className="rounded border px-2 py-1"
              />
            </label>
            <button className="rounded border px-3 py-1 text-sm">Enregistrer le suivi</button>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            Champs de suivi uniquement — l’application ne produit aucune facture.
          </p>
        </section>
      ))}

      {cras.length === 0 && <p className="text-slate-500">Aucun CRA ouvert sur ce mois.</p>}
    </main>
  )
}
