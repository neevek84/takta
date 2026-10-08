import { headers } from 'next/headers'
import { accesAdministration } from '@/auth'
import { AccesRefuse } from '@/components/ui/AccesRefuse'
import { Banner } from '@/components/ui/Banner'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { originePublique } from '@/core/http/origine'
import { vueReglagesSignature } from '@/services/signature/reglages'
import { ConnexionForm } from './ConnexionForm'
import { SecretWebhook } from './SecretWebhook'
import { TestConnexion } from './TestConnexion'

/** Le chemin de la route qui reçoit les livraisons de Documenso. */
const CHEMIN_WEBHOOK = '/api/webhooks/signature'

/** Les événements à cocher dans Documenso : ceux que le webhook sait lire. */
const EVENEMENTS = ['DOCUMENT_COMPLETED', 'DOCUMENT_REJECTED', 'DOCUMENT_CANCELLED'] as const

/**
 * L'écran par lequel la signature électronique se configure **et se
 * vérifie** : l'instance Documenso et sa clé, le secret du webhook, et l'URL
 * à déclarer chez Documenso.
 *
 * Les variables d'environnement restent un repli, pour les instances réglées
 * avant cet écran ; ce qui s'enregistre ici l'emporte, et l'écran dit lequel
 * des deux est en vigueur. Rien de tout cela n'est obligatoire : sans
 * instance, le PDF se télécharge et les transitions restent manuelles.
 */
export default async function AdminSignaturePage({
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

  const [vue, origine] = await Promise.all([vueReglagesSignature(), origineDeLaRequete()])
  const urlWebhook = origine === '' ? '' : `${origine}${CHEMIN_WEBHOOK}`

  return (
    <PageShell title="Administration · Signature">
      {message !== undefined && (
        <div className="mb-6">
          <Banner tone={toneMessage}>{message}</Banner>
        </div>
      )}

      <ConnexionForm
        // Une URL venue de l'environnement ne descend pas au client : il ne
        // la préremplit pas, elle n'a rien à y faire.
        baseUrl={vue.connexion.provenance === 'env' ? '' : vue.connexion.baseUrl}
        provenance={vue.connexion.provenance}
        enregistreLe={vue.connexion.enregistreLe}
        ligne={vue.connexion.ligne}
        illisible={vue.connexion.illisible}
      />

      <Card title="Webhook à déclarer dans Documenso" className="mt-6">
        <p className="mb-3 text-sm text-muted">
          Dans Documenso, ouvrez les réglages de l’équipe, section « Webhooks », et créez-en un avec
          l’URL, les événements et le secret ci-dessous.
        </p>
        {urlWebhook === '' ? (
          <Banner tone="warning" title="L’adresse publique n’a pas pu être déterminée">
            <p>
              Composez l’URL à la main : l’adresse de cette application, suivie de{' '}
              <code>{CHEMIN_WEBHOOK}</code>.
            </p>
          </Banner>
        ) : (
          <p>
            {/* Sélectionnable d'un geste, sans bouton « copier » : le
                presse-papiers exige un contexte sécurisé, absent en http local. */}
            <code className="block break-all rounded-md border border-rule bg-off px-3 py-2 text-sm text-ink">
              {urlWebhook}
            </code>
          </p>
        )}
        <p className="mt-3 text-sm text-ink">Événements à cocher :</p>
        <ul className="ml-5 list-disc text-sm text-ink">
          {EVENEMENTS.map((e) => (
            <li key={e}>
              <code>{e}</code>
            </li>
          ))}
        </ul>

        <SecretWebhook
          provenance={vue.webhook.provenance}
          genereLe={vue.webhook.genereLe}
          illisible={vue.webhook.illisible}
        />
      </Card>

      <TestConnexion />
    </PageShell>
  )
}

/**
 * L'origine publique de l'application : `AUTH_URL` si elle est déclarée,
 * sinon les en-têtes de la requête. Elle ne sert qu'à **afficher** l'URL à
 * recopier chez Documenso.
 */
async function origineDeLaRequete(): Promise<string> {
  const h = await headers()
  return originePublique(process.env.AUTH_URL, (nom) => h.get(nom))
}
