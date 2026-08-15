import { requireUser } from '@/auth'
import { getTheme, validateTheme } from '@/services/theme'
import { ThemeForm } from './ThemeForm'

export default async function AdminThemePage() {
  await requireUser()
  const theme = await getTheme()

  // `getTheme` répare la forme, jamais le contraste : une palette écrite à la
  // main, reprise d'un export, ou validée sous une version antérieure de la
  // table des couples peut être rendue tout en n'étant plus enregistrable. Le
  // service le sait ; sans cet appel, il n'en dirait rien et l'exploitant ne
  // découvrirait le problème qu'en tentant un enregistrement.
  //
  // C'est le seul endroit où un avertissement est légitime : il ne contourne
  // aucun refus — la barrière reste `updateTheme`, côté service — il signale
  // un état déjà présent en base.
  const verdict = validateTheme(theme)

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-2 text-xl">Administration · Thème</h1>
      <p className="mb-6 text-sm text-muted">
        Chaque couple texte/fond est vérifié au moment d’enregistrer. Une palette dont un couple
        de texte descend sous 4,5:1 — ou dont un couple non textuel (anneau de focus, accent
        foncé) descend sous 3:1 — est refusée, avec le couple fautif et son rapport.
      </p>

      {!verdict.ok && (
        <div
          role="alert"
          className="mb-6 rounded-md border border-warning-edge bg-warning px-3 py-2 text-sm text-warning-ink"
        >
          <p className="font-medium">
            La palette actuellement enregistrée ne passerait plus le contrôle :
          </p>
          <ul className="mt-1 list-disc pl-5">
            {verdict.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className="mt-1">
            Elle reste appliquée. Corrigez les couples ci-dessus, ou revenez au thème par défaut.
          </p>
        </div>
      )}

      <ThemeForm theme={theme} />
    </main>
  )
}
