import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { reloadHolidays } from './actions'
import { SettingsForm } from './SettingsForm'

export default async function AdminSaisiePage() {
  await requireUser()
  const s = await getSettings()

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-semibold">Administration · Saisie</h1>

      <SettingsForm settings={s} />

      <section className="mt-8 border-t pt-4">
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
