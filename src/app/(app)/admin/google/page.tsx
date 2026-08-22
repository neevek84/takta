import { headers } from 'next/headers'
import { accesAdministration } from '@/auth'
import { AccesRefuse } from '@/components/ui/AccesRefuse'
import { GOOGLE_CALLBACK_PATH, redirectUriPour } from '@/core/google/oauth-client'
import { getGoogleOAuthClientView } from '@/services/google/oauth-client'
import { Banner } from '@/components/ui/Banner'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { ClientOAuthForm } from './ClientOAuthForm'

/**
 * L'écran par lequel le client OAuth Google se configure, et par lequel il se
 * configure **entièrement** : plus rien à ouvrir dans un éditeur de texte.
 *
 * Ce que l'application ne peut pas faire à la place de son utilisateur — créer
 * un client OAuth chez Google et y ajouter le périmètre calendrier — reste à
 * faire. Le rôle de cet écran est de rendre l'étape suivante évidente : ce
 * qu'il faut créer, où, et quelle URL de retour y coller.
 */
export default async function AdminGooglePage({
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
  // retombe sur l'avertissement, jamais sur le succès.
  const toneMessage = tone === 'success' ? 'success' : tone === 'danger' ? 'danger' : 'warning'

  const [client, adresseServie] = await Promise.all([
    getGoogleOAuthClientView(),
    adresseDeLaRequete(),
  ])
  const urlRetourProposee = redirectUriPour(adresseServie)

  return (
    <PageShell title="Administration · Google">
      {message !== undefined && (
        <div className="mb-6">
          <Banner tone={toneMessage}>{message}</Banner>
        </div>
      )}

      <Card title="Ce qu'il faut créer chez Google">
        <ol className="ml-5 list-decimal text-sm text-ink">
          <li>
            Ouvrez la console Google Cloud, section « Identifiants », et créez un identifiant OAuth
            2.0 de type « Application Web ».
          </li>
          <li>
            Activez l’API Google Calendar sur le même projet, et ajoutez le périmètre
            <code className="px-1">https://www.googleapis.com/auth/calendar</code>.
          </li>
          <li>
            Ajoutez l’URL de retour autorisée ci-dessous, <strong>au caractère près</strong>.
          </li>
          <li>Recopiez ici l’identifiant et le secret que Google vous rend.</li>
        </ol>
      </Card>

      <Card title="URL de retour à enregistrer chez Google" className="mt-6">
        <p className="mb-3 text-sm text-muted">
          Elle est calculée depuis l’adresse par laquelle vous avez atteint cet écran. Google exige
          une correspondance exacte : recopiez-la telle quelle dans « URI de redirection autorisés ».
        </p>
        {urlRetourProposee === '' ? (
          <Banner tone="warning" title="L’adresse servie n’a pas pu être déterminée">
            <p>
              Composez l’URL à la main : l’adresse de cette application, suivie de{' '}
              <code>{GOOGLE_CALLBACK_PATH}</code>.
            </p>
          </Banner>
        ) : (
          <p>
            {/* Sélectionnable d'un geste, sans bouton « copier » : un bouton de
                copie exige le presse-papiers, indisponible hors contexte
                sécurisé — donc précisément en http sur un port local. */}
            <code className="block break-all rounded-md border border-rule bg-off px-3 py-2 text-sm text-ink">
              {urlRetourProposee}
            </code>
          </p>
        )}
      </Card>

      <div className="mt-6">
        <ClientOAuthForm
          clientId={client?.clientId ?? ''}
          redirectUri={client?.redirectUri ?? ''}
          urlRetourProposee={urlRetourProposee}
          configure={client !== null}
          configuredAt={client?.configuredAt ?? null}
        />
      </div>

      <Card title="Si le numéro de port change" className="mt-6">
        <p className="text-sm text-ink">
          L’URL de retour contient le port. Démarrer l’application sur un autre port produit donc une
          URL différente, que Google refuse tant qu’elle n’a pas été enregistrée : la connexion
          échoue alors avec un message de Google, et non de cette application.
        </p>
        <p className="mt-2 text-sm text-ink">
          Le démarrage portable garde le port 3000 tant qu’il est libre, et refuse de démarrer si un
          port imposé par <code>CRA_PORT</code> est occupé, plutôt que d’en changer en silence. S’il
          bascule malgré tout, il l’annonce : il faut alors enregistrer la nouvelle URL de retour
          chez Google, puis la reporter dans le champ ci-dessus.
        </p>
      </Card>
    </PageShell>
  )
}

/**
 * L'adresse par laquelle cet écran vient d'être atteint.
 *
 * Elle ne sert **qu'à afficher** l'URL de retour à enregistrer : c'est une
 * proposition à recopier chez Google, pas la valeur employée pour construire
 * la redirection de consentement. Celle-là est toujours la valeur enregistrée,
 * relue en base — un en-tête `Host` forgé ne peut donc pas détourner un code de
 * consentement, il ne peut au pire que proposer une URL saugrenue dans un champ
 * que l'exploitant relit avant de l'enregistrer.
 */
async function adresseDeLaRequete(): Promise<string> {
  const h = await headers()
  const hote = (h.get('x-forwarded-host') ?? h.get('host') ?? '').split(',')[0]?.trim() ?? ''
  if (hote === '') return ''

  const declare = (h.get('x-forwarded-proto') ?? '').split(',')[0]?.trim() ?? ''
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(hote)
  const protocole = declare !== '' ? declare : local ? 'http' : 'https'
  return `${protocole}://${hote}`
}
