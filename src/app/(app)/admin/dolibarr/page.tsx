import { requireUser } from '@/auth'
import { getInstanceCredential } from '@/services/credentials'
import { listClients } from '@/services/clients'
import { listMissionsForUser } from '@/services/missions'
import { DOLIBARR } from '@/services/dolibarr/api'
import { getDolibarrApi } from '@/services/dolibarr/resolve'
import { listImportCandidates, type ImportCandidates } from '@/services/dolibarr/import'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageShell } from '@/components/ui/PageShell'
import { Select } from '@/components/ui/Select'
import { ConnexionForm } from './ConnexionForm'
import { rattacherTiers, rattacherProjet, detacher, pousserClient } from './actions'

/**
 * L'écran par lequel la connexion à Dolibarr se configure, et par lequel les
 * objets des deux côtés se rattachent **à la main**.
 *
 * Rien n'est importé automatiquement : une base qui contient déjà des clients
 * saisis à la main se retrouverait en doublons, et la spec §7 le proscrit.
 *
 * Rien n'oblige à connecter Dolibarr non plus. La page est utilisable
 * connectée comme déconnectée, et une instance en panne n'y produit qu'un
 * bandeau — la saisie et la validation des CRA n'en dépendent pas.
 */
export default async function AdminDolibarrPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; tone?: string }>
}) {
  const user = await requireUser()
  const { message, tone } = await searchParams
  // Une tonalité forgée ou absente retombe sur « success » : c'est déjà le
  // comportement historique de ce canal, pour les messages qui ne portent pas
  // de tonalité explicite.
  const toneMessage = tone === 'danger' ? 'danger' : 'success'

  const [credential, api, clients, missions] = await Promise.all([
    getInstanceCredential(DOLIBARR),
    getDolibarrApi(),
    listClients(user.id),
    listMissionsForUser(user.id),
  ])

  let candidats: ImportCandidates | null = null
  let panne: string | null = null

  if (api !== null) {
    try {
      candidats = await listImportCandidates(user.id, api)
    } catch (err) {
      panne = err instanceof Error ? err.message : String(err)
    }
  }

  return (
    <PageShell title="Administration · Dolibarr">
      {message !== undefined && (
        <div className="mb-6">
          <Banner tone={toneMessage}>{message}</Banner>
        </div>
      )}

      <ConnexionForm
        baseUrl={credential?.baseUrl ?? ''}
        dolibarrUserId={credential?.metadata.dolibarrUserId ?? ''}
        connecte={credential !== null}
        connectedAt={credential?.connectedAt ?? null}
      />

      {panne !== null && (
        <div className="mt-6">
          <Banner tone="warning" title="Dolibarr est momentanément injoignable">
            <p>{panne}</p>
            <p>La saisie et la validation des CRA fonctionnent normalement.</p>
          </Banner>
        </div>
      )}

      {candidats !== null && (
        <>
          <Card title="Tiers Dolibarr" className="mt-6">
            <p className="mb-3 text-sm text-muted">
              Rattachez chaque tiers à un client existant, ou créez le client correspondant. Rien
              n’est importé automatiquement.
            </p>
            {candidats.tiers.length === 0 ? (
              <p className="text-sm text-muted">Cette instance ne propose aucun tiers.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {candidats.tiers.map((t) => (
                  <li key={t.id} className="rounded-md border border-rule p-3">
                    <fieldset>
                      <legend className="text-sm font-medium text-ink">{t.name}</legend>
                      {t.clientId === null ? (
                        <form
                          action={rattacherTiers}
                          className="mt-2 flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="dolibarrId" value={t.id} />
                          <input type="hidden" name="nom" value={t.name} />
                          <Select
                            label={`Client local pour « ${t.name} »`}
                            name="clientId"
                            defaultValue=""
                          >
                            <option value="">Créer le client « {t.name} »</option>
                            {clients.map((c) => (
                              <option key={c.id} value={c.id}>
                                Rattacher à {c.name}
                              </option>
                            ))}
                          </Select>
                          <Button
                            type="submit"
                            variant="primary"
                            aria-label={`Rattacher « ${t.name} »`}
                          >
                            Rattacher
                          </Button>
                        </form>
                      ) : (
                        <form action={detacher} className="mt-2 flex flex-wrap items-center gap-2">
                          <input type="hidden" name="entityType" value="Client" />
                          <input type="hidden" name="entityId" value={t.clientId} />
                          <p className="text-sm text-muted">
                            {t.clientName === null
                              ? 'Rattaché à un client d’un autre consultant.'
                              : `Rattaché à « ${t.clientName} ».`}
                          </p>
                          <Button type="submit" aria-label={`Détacher « ${t.name} »`}>
                            Détacher
                          </Button>
                        </form>
                      )}
                    </fieldset>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Projets Dolibarr facturables au temps" className="mt-6">
            <p className="mb-3 text-sm text-muted">
              Seuls les projets facturables au temps apparaissent : un projet qui ne l’est pas n’a
              aucune tâche où pousser un temps passé.
            </p>
            {candidats.projets.length === 0 ? (
              <p className="text-sm text-muted">
                Cette instance ne propose aucun projet facturable au temps.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {candidats.projets.map((p) => (
                  <li key={p.id} className="rounded-md border border-rule p-3">
                    <fieldset>
                      <legend className="text-sm font-medium text-ink">
                        {p.ref} · {p.title}
                      </legend>
                      {p.missionId === null && clients.length === 0 ? (
                        <p className="mt-2 text-sm text-muted">
                          Rattachez d’abord un tiers pour obtenir un client local : une mission
                          n’existe pas sans client.
                        </p>
                      ) : p.missionId === null ? (
                        <form
                          action={rattacherProjet}
                          className="mt-2 flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="dolibarrId" value={p.id} />
                          <input type="hidden" name="titre" value={p.title} />
                          <input type="hidden" name="ref" value={p.ref} />
                          <input type="hidden" name="socid" value={p.socid ?? ''} />
                          <Select
                            label={`Mission locale pour « ${p.ref} »`}
                            name="missionId"
                            defaultValue=""
                          >
                            <option value="">Créer la mission « {p.title} »</option>
                            {missions.map((m) => (
                              <option key={m.id} value={m.id}>
                                Rattacher à {m.clientName} · {m.label}
                              </option>
                            ))}
                          </Select>
                          <Select label={`Client de la mission à créer pour « ${p.ref} »`} name="clientId">
                            {clients.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </Select>
                          <Button
                            type="submit"
                            variant="primary"
                            aria-label={`Rattacher « ${p.ref} »`}
                          >
                            Rattacher
                          </Button>
                        </form>
                      ) : (
                        <form action={detacher} className="mt-2 flex flex-wrap items-center gap-2">
                          <input type="hidden" name="entityType" value="Mission" />
                          <input type="hidden" name="entityId" value={p.missionId} />
                          <p className="text-sm text-muted">
                            {p.missionLabel === null
                              ? 'Rattaché à une mission d’un autre consultant.'
                              : `Rattaché à « ${p.missionLabel} ».`}
                          </p>
                          <Button type="submit" aria-label={`Détacher « ${p.ref} »`}>
                            Détacher
                          </Button>
                        </form>
                      )}
                    </fieldset>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Pousser un client vers Dolibarr" className="mt-6">
            <p className="mb-3 text-sm text-muted">
              Le sens inverse : créer dans Dolibarr le tiers correspondant à un client saisi ici.
              Un client déjà rattaché n’est jamais créé une seconde fois.
            </p>
            {clients.length === 0 ? (
              <p className="text-sm text-muted">Aucun client local à pousser pour l’instant.</p>
            ) : (
              <form action={pousserClient} className="flex flex-wrap items-end gap-2">
                <Select label="Client local à créer dans Dolibarr" name="clientId">
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="primary">
                  Créer le tiers
                </Button>
              </form>
            )}
          </Card>
        </>
      )}
    </PageShell>
  )
}
