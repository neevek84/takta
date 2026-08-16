import Link from 'next/link'
import { requireUser } from '@/auth'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DataTable } from '@/components/ui/DataTable'
import { PageShell } from '@/components/ui/PageShell'
import { listWebhooks, readSeuilSuspension } from '@/services/webhooks/subscriptions'
import { listDeliveries } from '@/services/webhooks/delivery'
import { renvoyerLivraison } from '../supervision/actions'
import { WebhookForm } from './WebhookForm'
import { essayerAbonnement, modifierAbonnement, supprimerAbonnement } from './actions'

export const dynamic = 'force-dynamic'

const CHEMIN = '/admin/webhooks'

const ETATS_LIVRAISON: Record<string, { libelle: string; tone: Tone; glyph: string }> = {
  PENDING: { libelle: 'En attente', tone: 'neutral', glyph: '·' },
  SUCCES: { libelle: 'Réussie', tone: 'success', glyph: '✓' },
  ECHEC: { libelle: 'Échec', tone: 'warning', glyph: '▲' },
  ABANDONNE: { libelle: 'Abandonnée', tone: 'danger', glyph: '✕' },
}

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; tone?: string }>
}) {
  const user = await requireUser()
  const filtres = await searchParams

  // Une tonalité absente ou forgée retombe sur l'avertissement, jamais sur le
  // succès : un refus ne doit pas pouvoir se peindre en réussite.
  const toneMessage =
    filtres.tone === 'success' ? 'success' : filtres.tone === 'danger' ? 'danger' : 'warning'

  const [abonnements, seuil, livraisons] = await Promise.all([
    listWebhooks(user.id),
    readSeuilSuspension(),
    listDeliveries(user.id, 50),
  ])

  return (
    <PageShell title="Abonnements sortants">
      <div className="flex flex-col gap-6">
        {filtres.message !== undefined && <Banner tone={toneMessage}>{filtres.message}</Banner>}

        <Card title="Ce que fait cet écran">
          <p className="text-sm text-muted">
            L’application n’appelle que les URL enregistrées ici. Chaque appel est signé
            (HMAC-SHA256 du corps brut) avec le secret propre à l’abonnement, qui ne
            s’affiche jamais. La poussée n’est qu’un confort : tout reste lisible par
            <code> GET /api/events?since=…</code>. L’état des travaux et l’historique du
            journal se lisent sur l’écran{' '}
            <Link href="/admin/supervision" className="text-link underline">
              Supervision
            </Link>
            .
          </p>
        </Card>

        <Card title="Abonnements">
          {abonnements.length === 0 ? (
            <p className="text-sm text-muted">Aucun abonnement enregistré.</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {abonnements.map((abonnement) => {
                const suspendu = abonnement.state === 'SUSPENDU'
                return (
                  <li key={abonnement.id} className="border-t border-rule pt-3 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{abonnement.label}</span>
                      <Badge
                        tone={suspendu ? 'danger' : 'success'}
                        glyph={suspendu ? '✕' : '✓'}
                      >
                        {suspendu ? 'Suspendu' : 'Actif'}
                      </Badge>
                    </div>

                    <p className="text-sm text-muted">{abonnement.url}</p>
                    <p className="text-xs text-muted">
                      {abonnement.events.length === 0
                        ? 'Tous les événements'
                        : abonnement.events.join(' · ')}
                      {' — '}dernier événement pris en compte : {abonnement.lastSeq}
                    </p>

                    {/* Le compteur, toujours affiché, et son seuil. Il est
                        **commun à tous les événements** de l'abonnement : deux
                        événements malheureux se cumulent, et l'abonnement est
                        suspendu sans que son URL soit morte pour autant. */}
                    <p className="mt-1 text-xs text-muted">
                      {abonnement.consecutiveFailures} échec(s) consécutif(s) sur {seuil} avant
                      suspension — tous événements confondus.
                      {abonnement.lastError !== '' && ` Dernière erreur : ${abonnement.lastError}.`}
                    </p>

                    {suspendu && (
                      <p className="mt-1 text-xs text-muted">
                        Les événements reçus pendant la suspension restent lisibles :
                        <code> GET /api/events?since={abonnement.lastSeq}</code>. La
                        réactivation reprend à l’instant présent, sans déverser l’arriéré —
                        notez ce numéro <strong>avant</strong> de réactiver.
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap gap-2">
                      <form action={essayerAbonnement}>
                        <input type="hidden" name="id" value={abonnement.id} />
                        <Button type="submit" variant="secondary">Essayer</Button>
                      </form>
                      <form action={modifierAbonnement}>
                        <input type="hidden" name="id" value={abonnement.id} />
                        <input type="hidden" name="state" value={suspendu ? 'ACTIF' : 'SUSPENDU'} />
                        <Button type="submit" variant="quiet">
                          {suspendu ? 'Réactiver' : 'Suspendre'}
                        </Button>
                      </form>
                      <form action={supprimerAbonnement}>
                        <input type="hidden" name="id" value={abonnement.id} />
                        <Button type="submit" variant="danger">Supprimer</Button>
                      </form>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card title="Nouvel abonnement">
          <WebhookForm />
        </Card>

        <Card title="Dernières livraisons">
          {livraisons.length === 0 ? (
            <p className="text-sm text-muted">Aucune livraison pour l’instant.</p>
          ) : (
            <DataTable caption="Tentatives d’appel sortant">
              <thead>
                <tr>
                  <th scope="col" className="p-2 text-left">Abonnement</th>
                  <th scope="col" className="p-2 text-left">N°</th>
                  <th scope="col" className="p-2 text-left">Événement</th>
                  <th scope="col" className="p-2 text-left">État</th>
                  <th scope="col" className="p-2 text-left">Tentatives</th>
                  <th scope="col" className="p-2 text-left">Réponse</th>
                  <th scope="col" className="p-2 text-left">Durée</th>
                  <th scope="col" className="p-2 text-left">Erreur</th>
                  <th scope="col" className="p-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody>
                {livraisons.map((livraison) => {
                  const etat = ETATS_LIVRAISON[livraison.state] ?? ETATS_LIVRAISON['PENDING']!
                  return (
                    <tr key={livraison.id} className="border-t border-rule align-top">
                      <td className="p-2">{livraison.webhookLabel}</td>
                      <td className="p-2 tabular-nums">{livraison.seq}</td>
                      <td className="p-2">{livraison.action}</td>
                      <td className="p-2">
                        <Badge tone={etat.tone} glyph={etat.glyph}>{etat.libelle}</Badge>
                      </td>
                      <td className="p-2 tabular-nums">{livraison.attempts}</td>
                      <td className="p-2 tabular-nums">
                        {livraison.responseStatus === 0 ? '—' : livraison.responseStatus}
                      </td>
                      <td className="p-2 tabular-nums">{livraison.durationMs} ms</td>
                      <td className="p-2 text-xs text-danger-ink">{livraison.lastError}</td>
                      <td className="p-2">
                        <form action={renvoyerLivraison}>
                          <input type="hidden" name="id" value={livraison.id} />
                          {/* D'où l'on vient : l'action est partagée avec
                              l'écran de supervision, et rend la main ici. */}
                          <input type="hidden" name="retour" value={CHEMIN} />
                          <Button type="submit" variant="quiet">Renvoyer</Button>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </DataTable>
          )}
        </Card>
      </div>
    </PageShell>
  )
}
