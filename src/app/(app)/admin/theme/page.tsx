import { requireUser } from '@/auth'
import { getThemeConfig, validateThemeConfig } from '@/services/theme'
import { PageShell } from '@/components/ui/PageShell'
import { ThemeForm } from './ThemeForm'

export default async function AdminThemePage() {
  await requireUser()
  const config = await getThemeConfig()

  // `getThemeConfig` répare la forme, jamais le contraste : une palette écrite
  // à la main, reprise d'un export, ou validée sous une version antérieure de
  // la table des couples peut être rendue tout en n'étant plus enregistrable.
  // C'est aussi le cas d'une configuration reprise du lot 1e, dont la palette
  // de marque n'avait jamais été confrontée aux fonds qui la portent. Le
  // service le sait ; sans cet appel, il n'en dirait rien et l'exploitant ne
  // découvrirait le problème qu'en tentant un enregistrement.
  //
  // C'est le seul endroit où un avertissement est légitime : il ne contourne
  // aucun refus — la barrière reste `updateThemeConfig`, côté service — il
  // signale un état déjà présent en base.
  const verdict = validateThemeConfig(config)

  return (
    <PageShell title="Administration · Thème">
      <p className="mb-6 text-sm text-muted">
        Les deux palettes sont vérifiées au moment d’enregistrer. Une palette dont un couple de
        texte descend sous 4,5:1 — ou dont un couple non textuel (anneau de focus, accent foncé)
        descend sous 3:1 — est refusée, avec le couple fautif et son rapport. Les six teintes qui
        distinguent les prestations le sont aussi : entre elles, et contre les fonds qui les
        portent.
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
            {verdict.errors.map((e: string) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className="mt-1">
            Elle reste appliquée. Corrigez les couples ci-dessus, ou revenez au thème par défaut.
          </p>
        </div>
      )}

      <ThemeForm config={config} />
    </PageShell>
  )
}
