'use client'

import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { libelleMois } from '@/core/cra/document'
import type { ChoixPrevisionnel } from '@/services/cra-generation'

/**
 * La question posée avant de générer un CRA : que devient le prévisionnel du
 * mois ?
 *
 * **Aucun choix par défaut, et c'est le cœur de la demande.** Un client
 * demande son CRA le 20 : les jours du 21 au 31 sont saisis, connus, engagés.
 * Ils doivent figurer sur le document — ou disparaître —, mais c'est une
 * décision, pas un effet de bord de la validation.
 *
 * Un panneau rendu dans le document, jamais `window.confirm` : celui-ci bloque
 * le fil et n'existe pas au test.
 */
export function PanneauGeneration({
  month,
  missionLabel,
  previsionnel,
  onChoix,
  onAnnuler,
}: {
  month: string
  missionLabel: string
  previsionnel: number
  onChoix: (choix: ChoixPrevisionnel) => void
  onAnnuler: () => void
}) {
  // Rien à trancher : le CRA s'ouvre sans question. L'appelant l'a déjà fait,
  // ce panneau ne doit alors rien peindre.
  if (previsionnel === 0) return null

  const jours = previsionnel === 1 ? '1 jour en prévisionnel' : `${previsionnel} jours en prévisionnel`

  return (
    <div className="mb-3">
      <Banner tone="warning" title={`Générer le CRA de ${libelleMois(month)} ?`}>
        <p className="mb-2">
          Ce mois porte encore {jours} sur la mission « {missionLabel} ».
        </p>
        <p className="mb-2">
          <strong>Valider</strong> les passe en réalisé : ils compteront dans le CRA, y compris les
          jours à venir de ce mois. <strong>Les supprimer</strong> les retire définitivement, avec
          leurs blocs d’agenda — c’est irréversible.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" onClick={() => onChoix('VALIDER')}>
            Valider ces jours et générer
          </Button>
          <Button type="button" variant="danger" onClick={() => onChoix('SUPPRIMER')}>
            Les supprimer et générer
          </Button>
          <Button type="button" variant="quiet" onClick={onAnnuler}>
            Annuler
          </Button>
        </div>
      </Banner>
    </div>
  )
}
