'use client'

import { useState, useTransition } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { Origine } from '@/components/ui/Origine'
import {
  chargerImpactClient,
  detruireClient,
  rangerClient,
  sortirMissionDeLArchive,
  type DonneesState,
} from './actions'
import type { ImpactSuppression, Inventaire } from '@/services/archivage'

/**
 * Ranger, ressortir, détruire — pour les clients et les missions archivées.
 *
 * **Pourquoi un écran d'administration et pas la page des missions.** Une
 * mission archivée n'apparaît plus dans les missions : c'est le propre de
 * l'archivage. Il faut donc un endroit qui montre ce qui est rangé, sinon
 * ranger équivaudrait à perdre.
 *
 * La suppression d'un client emporte **toutes** ses missions. L'impact est
 * compté avant, et son nom doit être recopié.
 */
export function GestionDonnees({ inventaire }: { inventaire: Inventaire }) {
  const [etat, setEtat] = useState<DonneesState>(null)
  const [cible, setCible] = useState<string | null>(null)
  const [impact, setImpact] = useState<ImpactSuppression | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [enCours, demarrer] = useTransition()

  function viser(clientId: string) {
    demarrer(async () => {
      setEtat(null)
      setConfirmation('')
      setImpact(await chargerImpactClient(clientId))
      setCible(clientId)
    })
  }

  function agir(action: () => Promise<DonneesState>) {
    demarrer(async () => {
      setEtat(await action())
      setCible(null)
      setImpact(null)
      setConfirmation('')
    })
  }

  return (
    <>
      {etat !== null && (
        <div className="mb-4">
          <Banner tone={etat.ok ? 'success' : 'danger'}>
            {etat.ok ? etat.message : etat.erreur}
          </Banner>
        </div>
      )}

      <Card title="Clients">
        {inventaire.clients.length === 0 ? (
          <p className="text-sm text-muted">Aucun client.</p>
        ) : (
          <ul className="text-sm">
            {inventaire.clients.map((c) => (
              <li key={c.id} className="border-b border-rule py-2 last:border-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex-1">
                    {c.name}
                    {c.archived && <span className="ml-2 text-muted">— archivé</span>}
                  </span>
                  <span className="text-muted">
                    {c.missions} mission{c.missions > 1 ? 's' : ''}
                  </span>
                  <Origine
                    dansDolibarr={c.dansDolibarr}
                    detail={
                      c.dansDolibarr
                        ? 'rattaché à un tiers Dolibarr'
                        : 'client local : il ne vient d’aucun tiers Dolibarr'
                    }
                  />
                  <Button
                    type="button"
                    onClick={() => agir(() => rangerClient(c.id, !c.archived))}
                    disabled={enCours}
                  >
                    {c.archived ? 'Désarchiver' : 'Archiver'}
                  </Button>
                  <Button type="button" variant="danger" onClick={() => viser(c.id)} disabled={enCours}>
                    Supprimer…
                  </Button>
                </div>

                {cible === c.id && impact !== null && (
                  <div className="mt-3">
                    <div className="mb-2">
                      <Banner tone="danger" title={`Supprimer « ${c.name} » et ses ${c.missions} mission(s)`}>
                        <p>
                          Seront détruits : <strong>{impact.prestations}</strong> prestation(s),{' '}
                          <strong>{impact.saisies}</strong> saisie(s), <strong>{impact.cras}</strong>{' '}
                          CRA
                          {impact.crasValides > 0 && (
                            <>
                              {' '}
                              dont <strong>{impact.crasValides} validé(s)</strong>
                            </>
                          )}
                          , et <strong>{impact.correspondances}</strong> correspondance(s) Dolibarr.
                        </p>
                        <p>Rien ne sera supprimé dans Dolibarr.</p>
                      </Banner>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <Field
                        label={`Recopiez « ${c.name} » pour confirmer`}
                        name="confirmation"
                        value={confirmation}
                        onChange={(e) => setConfirmation(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="danger"
                        onClick={() => agir(() => detruireClient(c.id, confirmation))}
                        disabled={enCours || confirmation.trim() !== c.name}
                      >
                        Supprimer définitivement
                      </Button>
                      <Button type="button" onClick={() => setCible(null)} disabled={enCours}>
                        Annuler
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Missions archivées">
        {inventaire.missionsArchivees.length === 0 ? (
          <p className="text-sm text-muted">Aucune mission archivée.</p>
        ) : (
          <ul className="text-sm">
            {inventaire.missionsArchivees.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-3 border-b border-rule py-2 last:border-0"
              >
                <span className="flex-1">
                  {m.clientName} · {m.label}
                </span>
                <Button
                  type="button"
                  onClick={() => agir(() => sortirMissionDeLArchive(m.id))}
                  disabled={enCours}
                >
                  Désarchiver
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-sm text-muted">
          La suppression d’une mission se fait depuis son détail, dans l’écran Missions : c’est là
          que son contenu est visible.
        </p>
      </Card>
    </>
  )
}
