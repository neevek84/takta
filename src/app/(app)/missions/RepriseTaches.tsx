'use client'

import { useState, useTransition } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import {
  appliquerRepriseTaches,
  chargerTachesReprenables,
  type RepriseTachesState,
} from './actions'
import type { DecisionReprise, EtatReprise } from '@/services/dolibarr/reprise-taches'

/** Valeurs du choix par tâche. Un identifiant de prestation vaut « apparier ». */
const IGNORER = 'IGNORER'
const CREER = 'CREER'

/**
 * Reprendre en prestations les tâches d'un projet Dolibarr déjà en cours.
 *
 * **Replié, et chargé seulement à l'ouverture.** Lire les tâches interroge
 * Dolibarr : le faire au rendu de la page ferait dépendre l'affichage des
 * missions d'un aller-retour réseau par mission, et une instance injoignable
 * rendrait la page entière inutilisable.
 *
 * **Le défaut est « ignorer ».** Une reprise n'est pas un geste qu'on subit :
 * ouvrir le volet ne doit rien créer, et le porteur désigne explicitement ce
 * qu'il veut. Choisir « créer » pour tout par défaut fabriquerait des
 * prestations en double sur une mission qui en porte déjà.
 */
export function RepriseTaches({ missionId }: { missionId: string }) {
  const [etat, setEtat] = useState<EtatReprise | null>(null)
  const [choix, setChoix] = useState<Record<number, string>>({})
  const [resultat, setResultat] = useState<RepriseTachesState>(null)
  const [enCours, demarrer] = useTransition()

  function ouvrir() {
    demarrer(async () => {
      setResultat(null)
      const charge = await chargerTachesReprenables(missionId)
      setEtat(charge)
      setChoix(Object.fromEntries(charge.taches.map((t) => [t.taskId, IGNORER])))
    })
  }

  function appliquer() {
    if (etat === null) return
    const decisions: DecisionReprise[] = etat.taches
      .filter((t) => t.dejaLiee === null)
      .map((t) => {
        const valeur = choix[t.taskId] ?? IGNORER
        if (valeur === CREER) return { taskId: t.taskId, action: 'CREER' }
        if (valeur === IGNORER) return { taskId: t.taskId, action: 'IGNORER' }
        return { taskId: t.taskId, action: 'APPARIER', lineId: valeur }
      })

    demarrer(async () => {
      const r = await appliquerRepriseTaches(missionId, decisions)
      setResultat(r)
      // L'état est relu : une tâche reprise ne doit plus être proposée, et une
      // prestation appariée ne doit plus l'être une seconde fois.
      setEtat(await chargerTachesReprenables(missionId))
    })
  }

  if (etat === null) {
    return (
      <div className="mt-4">
        <Button type="button" onClick={ouvrir} disabled={enCours}>
          {enCours ? 'Lecture du projet Dolibarr…' : 'Reprendre les tâches du projet Dolibarr'}
        </Button>
      </div>
    )
  }

  if (etat.projectId === null) {
    return (
      <div className="mt-4">
        <Banner tone="info">
          Cette mission n’est rattachée à aucun projet Dolibarr : il n’y a pas de tâche à reprendre.
        </Banner>
      </div>
    )
  }

  const aReprendre = etat.taches.filter((t) => t.dejaLiee === null)
  const sansCharge = aReprendre.filter((t) => t.sansCharge).length

  return (
    <section className="mt-4 border-t border-rule pt-4">
      <h3 className="mb-2 font-medium">Reprendre les tâches du projet</h3>

      {resultat !== null && !resultat.ok && (
        <div className="mb-3">
          <Banner tone="danger">{resultat.erreur}</Banner>
        </div>
      )}
      {resultat !== null && resultat.ok && (
        <Banner tone={resultat.resultat.ecartees.length === 0 ? 'success' : 'warning'}>
          <p>
            {resultat.resultat.creees} prestation(s) créée(s), {resultat.resultat.appariees}{' '}
            appariée(s), {resultat.resultat.ignorees} ignorée(s).
          </p>
          {resultat.resultat.sansCharge > 0 && (
            <p>
              {resultat.resultat.sansCharge} prestation(s) sans jours vendus : la tâche Dolibarr n’en
              portait pas. Renseignez-les, sinon le reste à consommer sera faux.
            </p>
          )}
          {resultat.resultat.ecartees.map((motif) => (
            <p key={motif}>{motif}</p>
          ))}
        </Banner>
      )}

      {aReprendre.length === 0 ? (
        <p className="text-sm text-muted">
          Toutes les tâches de ce projet sont déjà reprises. Rien à faire.
        </p>
      ) : (
        <>
          {sansCharge > 0 && (
            <div className="mb-3">
              <Banner tone="warning">
                {sansCharge} tâche(s) ne portent aucune charge prévue chez Dolibarr : les
                prestations créées naîtront à zéro jour vendu, à compléter à la main.
              </Banner>
            </div>
          )}

          <ul className="mb-3 text-sm">
            {aReprendre.map((t) => (
              <li
                key={t.taskId}
                className="flex flex-wrap items-end gap-3 border-b border-rule py-2 last:border-0"
              >
                <span className="flex-1">
                  {t.label}
                  <span className="ml-2 text-muted">{t.ref}</span>
                </span>
                <span className={t.sansCharge ? 'text-muted' : ''}>
                  {t.sansCharge ? 'charge non renseignée' : `${t.joursVendusCentiemes / 100} j`}
                </span>
                <Select
                  label="Reprise"
                  name={`tache-${t.taskId}`}
                  value={choix[t.taskId] ?? IGNORER}
                  onChange={(e) => setChoix((c) => ({ ...c, [t.taskId]: e.target.value }))}
                >
                  <option value={IGNORER}>Ignorer</option>
                  <option value={CREER}>Créer une prestation</option>
                  {etat.prestations
                    .filter((p) => !p.dejaLiee)
                    .map((p) => (
                      <option key={p.lineId} value={p.lineId}>
                        Apparier à « {p.label} »
                      </option>
                    ))}
                </Select>
              </li>
            ))}
          </ul>

          <Button type="button" variant="primary" onClick={appliquer} disabled={enCours}>
            {enCours ? 'Reprise en cours…' : 'Appliquer'}
          </Button>
        </>
      )}
    </section>
  )
}
