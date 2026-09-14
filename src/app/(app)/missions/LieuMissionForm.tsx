'use client'

import { useActionState } from 'react'
import { saveLieuMission, type LieuMissionState } from './actions'
import { LIBELLES_LIEU, LIEUX, type Lieu } from '@/core/types'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'

/**
 * Le lieu par défaut d'une **mission** : chez le client ou à distance.
 *
 * Il ne décide que du pré-remplissage : chaque saisie en hérite et peut le
 * changer. Ce qu'il déclenche se dit ici, pas seulement dans le formulaire de
 * saisie — sinon on découvrirait les trajets dans l'agenda.
 */
export function LieuMissionForm({ missionId, lieuDefaut }: { missionId: string; lieuDefaut: Lieu }) {
  const [state, formAction, pending] = useActionState<LieuMissionState, FormData>(
    saveLieuMission,
    null,
  )

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="missionId" value={missionId} />
      <p className="text-sm text-muted">
        Chez le client, chaque nouvelle saisie pose un trajet avant et après dans l’agenda, une
        seule fois ; l’agenda en fait ensuite ce qu’il veut. Déplacer ou supprimer la saisie ne les
        déplace ni ne les retire.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Lieu par défaut" name="lieuDefaut" defaultValue={lieuDefaut} className="w-52">
          {LIEUX.map((l) => (
            <option key={l} value={l}>
              {LIBELLES_LIEU[l]}
            </option>
          ))}
        </Select>
        <Button type="submit" loading={pending}>
          Enregistrer le lieu
        </Button>
      </div>

      {state !== null && !state.ok && (
        <Banner tone="danger" title="Lieu non enregistré">
          {state.erreur}
        </Banner>
      )}
      {state?.ok === true && <Banner tone="success">Lieu enregistré.</Banner>}
    </form>
  )
}
