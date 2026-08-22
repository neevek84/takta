'use client'

import { useState, useTransition } from 'react'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import {
  chargerImpactMission,
  detacherMissionDeDolibarr,
  detruireMission,
  rangerMission,
  renommerMission,
  type GestionMissionState,
} from './actions'
import type { ImpactSuppression } from '@/services/archivage'

/**
 * Renommer, détacher, archiver, supprimer — quatre gestes qui ne s'échangent
 * pas.
 *
 * **Renommer** ne touche qu'au nom local. Le geste manquait entièrement : une
 * faute de frappe ou un intitulé qui change en cours de contrat n'avait pour
 * seule issue que la suppression de la mission — donc de ses saisies et de ses
 * CRA — pour la recréer. Rien n'est poussé chez Dolibarr : le projet distant
 * porte la référence d'un bon de commande, et l'application ne modifie jamais
 * un document commercial.
 *
 * **Détacher** rompt le lien avec Dolibarr et ne perd rien : c'est le geste qui
 * convient quand le projet distant a été supprimé, ce que Dolibarr ne dit à
 * personne et qui laisse l'application pousser dans le vide.
 *
 * **Archiver** range et se défait.
 *
 * **Supprimer** détruit. L'impact est donc affiché **avant**, et le libellé de
 * la mission doit être recopié : la suppression emporte des CRA peut-être
 * signés, et un clic ne doit pas suffire à les faire disparaître. Rien n'est
 * jamais supprimé chez Dolibarr — ce qui y a été poussé est l'historique du
 * client, parfois déjà facturé.
 */
export function GestionMission({
  missionId,
  label,
  dansDolibarr,
}: {
  missionId: string
  label: string
  /** la mission porte un lien vers un projet Dolibarr */
  dansDolibarr: boolean
}) {
  const [ouvert, setOuvert] = useState(false)
  const [libelle, setLibelle] = useState(label)
  const [impact, setImpact] = useState<ImpactSuppression | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [etat, setEtat] = useState<GestionMissionState>(null)
  const [enCours, demarrer] = useTransition()

  function ouvrir() {
    demarrer(async () => {
      setEtat(null)
      setImpact(await chargerImpactMission(missionId))
      setOuvert(true)
    })
  }

  function agir(action: () => Promise<GestionMissionState>) {
    demarrer(async () => {
      setEtat(await action())
      setImpact(await chargerImpactMission(missionId))
      setConfirmation('')
    })
  }

  if (!ouvert) {
    return (
      <div className="mt-4">
        <Button type="button" onClick={ouvrir} disabled={enCours}>
          Renommer, détacher, archiver ou supprimer cette mission
        </Button>
      </div>
    )
  }

  return (
    <section className="mt-4 border-t border-rule pt-4">
      <h3 className="mb-2 font-medium">Renommer, détacher, archiver ou supprimer</h3>

      {etat !== null && (
        <div className="mb-3">
          <Banner tone={etat.ok ? 'success' : 'danger'}>
            {etat.ok ? etat.message : etat.erreur}
          </Banner>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Field
          label="Nouveau libellé de la mission"
          name="libelle"
          value={libelle}
          onChange={(e) => setLibelle(e.target.value)}
          className="w-80"
          hint="Renommage local : le projet Dolibarr garde son nom et sa référence."
        />
        <Button
          type="button"
          onClick={() => agir(() => renommerMission(missionId, libelle))}
          // Une mission sans libellé n'est plus reconnaissable dans la liste,
          // et la confirmation de suppression n'aurait plus rien à recopier.
          disabled={enCours || libelle.trim() === ''}
        >
          Renommer
        </Button>
      </div>

      {dansDolibarr && (
        <p className="mb-3 text-sm">
          <Button
            type="button"
            onClick={() => agir(() => detacherMissionDeDolibarr(missionId))}
            disabled={enCours}
          >
            Détacher de Dolibarr
          </Button>{' '}
          <span className="text-muted">
            Rompt le lien sans rien détruire — le geste qui convient si le projet a été supprimé
            là-bas. Les saisies restent, et rien n’est supprimé dans Dolibarr.
          </span>
        </p>
      )}

      <p className="mb-3 text-sm">
        <Button type="button" onClick={() => agir(() => rangerMission(missionId, true))} disabled={enCours}>
          Archiver
        </Button>{' '}
        <span className="text-muted">
          Range la mission : elle sort des listes et de la saisie. Réversible depuis Réglages ·
          Données.
        </span>
      </p>

      {impact !== null && (
        <div className="mt-4 border-t border-rule pt-3">
          <div className="mb-2">
            <Banner tone="danger" title="Suppression définitive">
              <p>
                Seront détruits : <strong>{impact.prestations}</strong> prestation(s),{' '}
                <strong>{impact.saisies}</strong> saisie(s), <strong>{impact.cras}</strong> CRA
                {impact.crasValides > 0 && (
                  <>
                    {' '}
                    dont <strong>{impact.crasValides} validé(s)</strong>
                  </>
                )}
                , et <strong>{impact.correspondances}</strong> correspondance(s) Dolibarr.
              </p>
              {impact.crasValides > 0 && (
                <p>
                  Un CRA validé a été envoyé au client, parfois signé. Sa suppression efface la
                  seule trace locale de ce qui a été facturé.
                </p>
              )}
              <p>Rien ne sera supprimé dans Dolibarr.</p>
            </Banner>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <Field
              label={`Recopiez « ${label} » pour confirmer`}
              name="confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
            <Button
              type="button"
              variant="danger"
              onClick={() => agir(() => detruireMission(missionId, confirmation))}
              disabled={enCours || confirmation.trim() !== label}
            >
              Supprimer définitivement
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
