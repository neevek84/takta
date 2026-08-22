'use client'

import { useState, useTransition } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import {
  appliquerRepriseTemps,
  chargerTempsReprenables,
  type RepriseTempsState,
} from './actions'
import type { EtatRepriseTemps } from '@/services/dolibarr/reprise-temps'

/**
 * Reprendre les temps déjà consommés dans Dolibarr.
 *
 * **Vient après la reprise des tâches, et en dépend.** Un temps se pose sur une
 * prestation ; sans prestation reliée à une tâche, il n'a nulle part où
 * atterrir. L'écran le dit plutôt que de proposer un bouton qui ne ferait rien.
 *
 * **Le rappel de suppression n'est pas décoratif.** L'application ne supprime
 * jamais un temps chez Dolibarr — il peut être rattaché à une facture déjà
 * émise, que l'API ne montre pas. C'est le porteur qui supprime, chez Dolibarr,
 * les temps du mois en cours qu'il va ressaisir ici. Sans ce geste, le mois en
 * cours existera des deux côtés et sera facturé deux fois.
 */
export function RepriseTemps({ missionId }: { missionId: string }) {
  const [etat, setEtat] = useState<EtatRepriseTemps | null>(null)
  const [resultat, setResultat] = useState<RepriseTempsState>(null)
  const [enCours, demarrer] = useTransition()

  function ouvrir() {
    demarrer(async () => {
      setResultat(null)
      setEtat(await chargerTempsReprenables(missionId))
    })
  }

  function appliquer() {
    demarrer(async () => {
      setResultat(await appliquerRepriseTemps(missionId))
      setEtat(await chargerTempsReprenables(missionId))
    })
  }

  if (etat === null) {
    return (
      <div className="mt-4">
        <Button type="button" onClick={ouvrir} disabled={enCours}>
          {enCours ? 'Lecture des temps consommés…' : 'Reprendre les temps déjà saisis dans Dolibarr'}
        </Button>
      </div>
    )
  }

  const total = etat.prestations.reduce((n, p) => n + p.aReprendre, 0)
  const apres = etat.prestations.reduce((n, p) => n + p.apresCoupure, 0)
  const dejaRepris = etat.prestations.reduce((n, p) => n + p.dejaRepris, 0)

  return (
    <section className="mt-4 border-t border-rule pt-4">
      <h3 className="mb-2 font-medium">Reprendre les temps consommés</h3>

      {etat.prestations.length === 0 ? (
        <Banner tone="info">
          Aucune prestation de cette mission ne vise une tâche Dolibarr. Reprenez d’abord les tâches
          ci-dessus : les temps n’auraient nulle part où atterrir.
        </Banner>
      ) : (
        <>
          {resultat !== null && !resultat.ok && (
            <div className="mb-3">
              <Banner tone="danger">{resultat.erreur}</Banner>
            </div>
          )}
          {resultat !== null && resultat.ok && (
            <div className="mb-3">
              <Banner tone={resultat.resultat.ecartes.length === 0 ? 'success' : 'warning'}>
                <p>
                  {resultat.resultat.reprises} temps repris,{' '}
                  {resultat.resultat.utilisateursCrees} utilisateur(s) créé(s).
                </p>
                {resultat.resultat.moisVerrouilles.length > 0 && (
                  <p>
                    Mois verrouillés : {resultat.resultat.moisVerrouilles.join(', ')}. Les temps
                    repris sont considérés comme validés : ils ne repartiront jamais vers Dolibarr.
                  </p>
                )}
                {resultat.resultat.ecartes.map((motif) => (
                  <p key={motif}>{motif}</p>
                ))}
              </Banner>
            </div>
          )}

          <p className="mb-2 text-sm">
            Reprise jusqu’au <strong>{etat.coupure}</strong> inclus — {total} temps à reprendre
            {dejaRepris > 0 && `, ${dejaRepris} déjà repris`}
            {apres > 0 && `, ${apres} après la coupure`}.
          </p>

          <ul className="mb-3 text-sm">
            {etat.prestations.map((p) => (
              <li key={p.lineId} className="flex flex-wrap gap-4 border-b border-rule py-1 last:border-0">
                <span className="flex-1">{p.label}</span>
                <span className="text-muted">tâche n° {p.taskId}</span>
                <span>{p.aReprendre} à reprendre</span>
              </li>
            ))}
          </ul>

          {/* Le geste que l'application ne fera jamais à sa place. */}
          <div className="mb-3">
            <Banner tone="warning" title="À faire vous-même dans Dolibarr">
              <p>
                Les temps du <strong>mois en cours</strong> ne sont pas repris : vous les saisirez
                ici, et l’application les poussera à la validation du CRA.
              </p>
              <p>
                Supprimez-les donc <strong>dans Dolibarr</strong> avant de saisir, sinon ils
                existeront des deux côtés. L’application ne les supprimera jamais elle-même : elle
                ne peut pas savoir lesquels sont déjà portés par une facture émise.
              </p>
            </Banner>
          </div>

          <Button
            type="button"
            variant="primary"
            onClick={appliquer}
            disabled={enCours || total === 0}
          >
            {enCours ? 'Reprise en cours…' : `Reprendre ${total} temps`}
          </Button>
        </>
      )}
    </section>
  )
}
