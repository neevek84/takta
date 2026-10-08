import { accesAdministration } from '@/auth'
import { AccesRefuse } from '@/components/ui/AccesRefuse'
import { Banner } from '@/components/ui/Banner'
import { PageShell } from '@/components/ui/PageShell'
import { vueReglagesCourriel } from '@/services/courriel/reglages'
import { ReglagesForm } from './ReglagesForm'
import { TestEnvoi } from './TestEnvoi'

/**
 * L'écran par lequel l'envoi de courriel se configure **et se vérifie** : le
 * serveur SMTP, son mot de passe, et un vrai envoi de test.
 *
 * C'est par lui que partent les codes de signature, les rappels et les
 * alertes du journal. `SMTP_PASSWORD` reste un repli pour le mot de passe ;
 * ce qui s'enregistre ici l'emporte, et l'écran dit lequel est en vigueur.
 */
export default async function AdminCourrielPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; tone?: string }>
}) {
  // Le verdict **avant** tout service : rien de ce que cette page allait
  // lire n'est lu si l'accès est refusé.
  const { autorise, user } = await accesAdministration()
  if (!autorise) return <AccesRefuse role={user.role} />
  const { message, tone } = await searchParams
  // Rien ne se fait passer pour une réussite : une tonalité absente ou forgée
  // retombe sur l'avertissement.
  const toneMessage = tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : 'warning'

  const vue = await vueReglagesCourriel(user.id)

  return (
    <PageShell title="Administration · Courriel">
      {message !== undefined && (
        <div className="mb-6">
          <Banner tone={toneMessage}>{message}</Banner>
        </div>
      )}

      <div className="mb-6">
        {vue.complete ? (
          <Banner tone="success" title="Prêt à envoyer">
            Les codes de signature, les rappels et les alertes partiront par ce serveur.
            Envoyez un courriel de test pour le vérifier.
          </Banner>
        ) : (
          <Banner tone="warning" title="Envoi non configuré">
            Aucun courriel ne part : renseignez le serveur, le port, l’adresse d’expédition et, si
            un utilisateur est renseigné, son mot de passe.
          </Banner>
        )}
      </div>

      <ReglagesForm
        host={vue.host}
        port={vue.port}
        secure={vue.secure}
        user={vue.user}
        from={vue.from}
        provenance={vue.motDePasse.provenance}
        enregistreLe={vue.motDePasse.enregistreLe}
        illisible={vue.motDePasse.illisible}
      />

      <TestEnvoi adresseParDefaut={vue.adresseAdministrateur} />
    </PageShell>
  )
}
