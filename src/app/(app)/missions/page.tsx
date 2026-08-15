import { requireUser } from '@/auth'
import { prisma } from '@/db/client'
import { listClients } from '@/services/clients'
import { addClient, addMission, addLine } from './actions'

export default async function MissionsPage() {
  await requireUser()
  const clients = await listClients()
  const missions = await prisma.mission.findMany({
    where: { archived: false },
    include: { client: true, lines: { where: { archived: false } } },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Missions</h1>

      <section className="mb-8 flex flex-wrap gap-8">
        <form action={addClient} className="flex items-end gap-2">
          <label className="flex flex-col text-sm">
            Nouveau client
            <input name="name" required className="rounded border px-2 py-1" />
          </label>
          <button className="rounded bg-slate-900 px-3 py-1 text-white">Créer</button>
        </form>

        <form action={addMission} className="flex items-end gap-2">
          <label className="flex flex-col text-sm">
            Nouvelle mission
            <input name="label" required className="rounded border px-2 py-1" />
          </label>
          <select name="clientId" required className="rounded border px-2 py-1">
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button className="rounded bg-slate-900 px-3 py-1 text-white">Créer</button>
        </form>
      </section>

      {missions.map((m) => (
        <section key={m.id} className="mb-8 rounded border p-4">
          <h2 className="mb-3 font-medium">
            {m.client.name} · {m.label}
          </h2>

          <ul className="mb-4 text-sm">
            {m.lines.map((l) => (
              <li key={l.id} className="flex gap-4 border-b py-1 last:border-0">
                <span className="flex-1">{l.label}</span>
                <span>{l.soldCentiemes / 100} j</span>
                <span>{l.tjmCents / 100} €</span>
                <span className="text-slate-500">{l.displayUnit}</span>
              </li>
            ))}
            {m.lines.length === 0 && <li className="text-slate-500">Aucune ligne</li>}
          </ul>

          <form action={addLine} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="missionId" value={m.id} />
            <label className="flex flex-col text-sm">
              Ligne
              <input name="label" required className="rounded border px-2 py-1" />
            </label>
            <label className="flex flex-col text-sm">
              Jours vendus
              <input name="joursVendus" type="number" step="0.5" required className="w-28 rounded border px-2 py-1" />
            </label>
            <label className="flex flex-col text-sm">
              TJM (€)
              <input name="tjm" type="number" step="1" defaultValue={0} className="w-28 rounded border px-2 py-1" />
            </label>
            <select name="displayUnit" className="rounded border px-2 py-1">
              <option value="JOUR">Jour</option>
              <option value="DEMI_JOUR">Demi-journée</option>
              <option value="HEURE">Heure</option>
            </select>
            <button className="rounded bg-slate-900 px-3 py-1 text-white">Ajouter</button>
          </form>
        </section>
      ))}
    </main>
  )
}
