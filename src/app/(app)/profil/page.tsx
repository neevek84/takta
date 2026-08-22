import { requireUser } from '@/auth'
import { PageShell } from '@/components/ui/PageShell'
import { Banner } from '@/components/ui/Banner'
import { getConnectionState } from '@/services/google/connect'
import { identifiantDolibarrDe, suggestionDInstance } from '@/services/dolibarr/utilisateur'
import { ProfilClient } from './ProfilClient'

/**
 * L'écran qu'un `CONSULTANT` a le droit d'ouvrir — et le seul de ce lot.
 *
 * `requireUser()` et non `accesAdministration()` : tout ce qu'il porte est de
 * portée utilisateur, et les services appelés ne lisent que le compte de la
 * session. Il vit hors de `/admin/` pour cette raison, et pour que le contrôle
 * structurel de `src/admin-garde.test.ts` ne le prenne pas pour un écran
 * d'administration mal gardé.
 */
export default async function ProfilPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; tone?: string }>
}) {
  const user = await requireUser()
  const { message, tone } = await searchParams
  // Rien ne se fait passer pour une réussite : une tonalité absente ou forgée
  // retombe sur l'avertissement.
  const toneMessage = tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : 'warning'

  const [identifiant, suggestion, connection] = await Promise.all([
    identifiantDolibarrDe(user.id),
    suggestionDInstance(),
    getConnectionState(user.id),
  ])

  return (
    <PageShell title="Mon profil">
      {message !== undefined && (
        <div className="mb-6">
          <Banner tone={toneMessage}>{message}</Banner>
        </div>
      )}
      <ProfilClient
        identifiant={identifiant}
        suggestion={suggestion}
        connection={connection}
      />
    </PageShell>
  )
}
