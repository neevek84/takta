import { requireUser } from '@/auth'
import { getTheme } from '@/services/settings'
import { ThemeForm } from './ThemeForm'

export default async function AdminThemePage() {
  await requireUser()
  const theme = await getTheme()

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-xl">Administration · Thème</h1>
      <p className="mb-6 text-sm text-muted">
        Chaque couple texte/fond est vérifié au moment d’enregistrer. Une palette dont un couple
        descend sous 4,5:1 est refusée, avec le couple fautif et son rapport.
      </p>
      <ThemeForm theme={theme} />
    </main>
  )
}
