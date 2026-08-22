'use client'

import { useState, useTransition } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import {
  chargerImpactPrestation,
  detruirePrestation,
  rangerPrestation,
  type GestionMissionState,
} from './actions'
import type { ImpactSuppressionPrestation } from '@/services/archivage'

/**
 * Archiver ou supprimer une prestation — deux gestes qui ne s'échangent pas.
 *
 * **Archiver** range : la prestation sort de la grille de saisie et du détail
 * de la mission, ses temps restent lisibles, et le geste se défait. C'est ce
 * qu'il faut pour une prestation terminée, ou reprise d'une propale close.
 *
 * **Supprimer** détruit les saisies. L'impact est donc affiché **avant**, et le
 * libellé doit être recopié : une saisie d'un mois validé a été envoyée au
 * client, parfois facturée, et un clic ne doit pas suffire à la faire
 * disparaître. Le CRA du mois, lui, survit — c'est son contenu qui change, ce
 * qui est plus sournois qu'une disparition et doit donc être dit.
 *
 * Rien n'est jamais supprimé chez Dolibarr : ce qui y a été poussé est
 * l'historique du client, dont le porteur fait le ménage à la main.
 */
export function GestionPrestation({ lineId, label }: { lineId: string; label: string }) {
  const [ouvert, setOuvert] = useState(false)
  const [impact, setImpact] = useState<ImpactSuppressionPrestation | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [etat, setEtat] = useState<GestionMissionState>(null)
  const [enCours, demarrer] = useTransition()

  function ouvrir() {
    demarrer(async () => {
      setEtat(null)
      setImpact(await chargerImpactPrestation(lineId))
      setOuvert(true)
    })
  }

  function agir(action: () => Promise<GestionMissionState>) {
    demarrer(async () => {
      setEtat(await action())
      setImpact(await chargerImpactPrestation(lineId))
      setConfirmation('')
    })
  }

  if (!ouvert) {
    return (
      <Button type="button" className="mt-2" onClick={ouvrir} disabled={enCours}>
        Archiver ou supprimer « {label} »
      </Button>
    )
  }

  return (
    <section className="mt-3 border-t border-rule pt-3">
      <h4 className="mb-2 text-sm font-medium">Archiver ou supprimer « {label} »</h4>

      {etat !== null && (
        <div className="mb-3">
          <Banner tone={etat.ok ? 'success' : 'danger'}>
            {etat.ok ? etat.message : etat.erreur}
          </Banner>
        </div>
      )}

      <p className="mb-3 text-sm">
        <Button type="button" onClick={() => agir(() => rangerPrestation(lineId, true))} disabled={enCours}>
          Archiver
        </Button>{' '}
        <span className="text-muted">
          Range la prestation : elle sort de la saisie et du détail de la mission, ses temps
          restent. Réversible.
        </span>
      </p>

      {impact !== null && (
        <div className="mt-3 border-t border-rule pt-3">
          <div className="mb-2">
            <Banner tone="danger" title="Suppression définitive">
              <p>
                Seront détruites : <strong>{impact.saisies}</strong> saisie(s), dont{' '}
                <strong>{impact.saisiesValidees}</strong> dans un mois déjà validé, et{' '}
                <strong>{impact.correspondances}</strong> correspondance(s) Dolibarr.
              </p>
              {impact.crasValides > 0 && (
                <p>
                  Ces saisies figurent dans{' '}
                  <strong>{impact.crasValides} CRA validé(s)</strong>, envoyé(s) au client et
                  parfois signé(s). Le CRA ne sera pas détruit, mais son contenu ne concordera plus
                  avec le document déjà envoyé.
                </p>
              )}
              <p>Rien ne sera supprimé dans Dolibarr.</p>
            </Banner>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Field
              label={`Recopiez « ${label} » pour confirmer`}
              name="confirmationPrestation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
            <Button
              type="button"
              variant="danger"
              onClick={() => agir(() => detruirePrestation(lineId, confirmation))}
              disabled={enCours || confirmation.trim() !== label}
            >
              Supprimer définitivement
            </Button>
            <Button type="button" onClick={() => setOuvert(false)} disabled={enCours}>
              Fermer
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
