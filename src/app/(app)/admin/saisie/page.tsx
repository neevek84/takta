import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { saveSettings, reloadHolidays } from './actions'

const JOURS = [
  { value: 1, label: 'Lundi' },
  { value: 2, label: 'Mardi' },
  { value: 3, label: 'Mercredi' },
  { value: 4, label: 'Jeudi' },
  { value: 5, label: 'Vendredi' },
  { value: 6, label: 'Samedi' },
  { value: 7, label: 'Dimanche' },
]

export default async function AdminSaisiePage() {
  await requireUser()
  const s = await getSettings()

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Administration · Saisie</h1>

      <form action={saveSettings} className="flex flex-col gap-6">
        <fieldset>
          <legend className="mb-2 font-medium">Durée d’une journée</legend>
          <div className="flex items-center gap-2">
            <input
              name="heures"
              type="number"
              min={1}
              max={24}
              defaultValue={Math.floor(s.minutesParJour / 60)}
              className="w-20 rounded border px-2 py-1"
            />
            <span>h</span>
            <input
              name="minutes"
              type="number"
              min={0}
              max={59}
              defaultValue={s.minutesParJour % 60}
              className="w-20 rounded border px-2 py-1"
            />
            <span className="text-sm text-slate-500">min</span>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-medium">Contrôle de capacité</legend>
          <select
            name="capacityMode"
            defaultValue={s.capacityMode}
            className="rounded border px-2 py-1"
          >
            <option value="DESACTIVE">Désactivé</option>
            <option value="AVERTISSEMENT">Avertissement</option>
            <option value="BLOCAGE">Blocage</option>
          </select>
          <label className="ml-4 inline-flex items-center gap-2">
            <span className="text-sm">Seuil</span>
            <input
              name="capaciteJours"
              type="number"
              step="0.5"
              min="0.5"
              defaultValue={s.capacityCentiemes / 100}
              className="w-20 rounded border px-2 py-1"
            />
            <span className="text-sm text-slate-500">jour(s)</span>
          </label>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-medium">Jours ouvrés</legend>
          <div className="flex flex-wrap gap-3">
            {JOURS.map((j) => (
              <label key={j.value} className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  name="workingDays"
                  value={j.value}
                  defaultChecked={s.workingDays.includes(j.value)}
                />
                <span className="text-sm">{j.label}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Les autres jours restent saisissables ; ils sont seulement grisés.
          </p>
        </fieldset>

        <button type="submit" className="self-start rounded bg-slate-900 px-4 py-2 text-white">
          Enregistrer
        </button>
      </form>

      <section className="border-t pt-4">
        <h2 className="mb-2 font-medium">Jours fériés</h2>
        <p className="mb-2 text-sm text-slate-600">
          {s.holidays.length} jour(s) férié(s) enregistré(s). Ils sont grisés dans la grille
          mais restent saisissables.
        </p>
        <form action={reloadHolidays}>
          <button className="rounded border px-3 py-1 text-sm">
            Charger les fériés français (année précédente à N+2)
          </button>
        </form>
      </section>
    </main>
  )
}
