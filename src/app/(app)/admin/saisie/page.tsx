import { requireUser } from '@/auth'
import { getSettings } from '@/services/settings'
import { previewRecalibration } from '@/services/rates'
import { reloadHolidays } from './actions'
import { SettingsForm } from './SettingsForm'
import { PageShell } from '@/components/ui/PageShell'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export default async function AdminSaisiePage() {
  const user = await requireUser()
  const s = await getSettings()
  const preview = await previewRecalibration(user.id)

  return (
    <PageShell title="Administration · Saisie">
      <SettingsForm settings={s} preview={preview} />

      <Card className="mt-8">
        <h2 className="mb-2 font-medium">Jours fériés</h2>
        <p className="mb-2 text-sm text-muted">
          {s.holidays.length} jour(s) férié(s) enregistré(s). Ils sont grisés dans la grille
          mais restent saisissables.
        </p>
        <form action={reloadHolidays}>
          <Button type="submit" variant="secondary">
            Charger les fériés français (année précédente à N+2)
          </Button>
        </form>
      </Card>
    </PageShell>
  )
}
