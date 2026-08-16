'use client'

import { useState } from 'react'
import { isSlotAllowed } from '@/core/saisie/cycle'
import type { CellState } from '@/core/saisie/cycle'
import { cellStateToWrite } from '@/core/saisie/cell-state'
import { parseQuantity } from '@/core/time/units'
import type { Slot } from '@/core/time/slots'
import type { LineForGrid } from '@/services/missions'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'

/** Durée initiale, en heures, telle que le champ l'affiche. */
function dureeInitiale(etat: CellState, minutesParJour: number, slots: Slot[]): string {
  if (etat.kind === 'VIDE') return ''
  const minutes = cellStateToWrite(etat, { minutesParJour, slots }).reduce(
    (somme, e) => somme + e.minutes,
    0,
  )
  if (minutes === 0) return ''
  return String(Math.round((minutes / 60) * 100) / 100).replace('.', ',')
}

function creneauInitial(etat: CellState): string {
  if (etat.kind === 'DEMI') return etat.slotId
  if (etat.kind === 'LIBRE') return etat.slotId
  return ''
}

/**
 * Saisie d'une durée libre et d'un créneau, ouverte par appui long, clic
 * droit, ou — au clavier — Maj+Entrée ou la touche Menu sur une case (voir
 * `MonthCalendar`).
 *
 * Un créneau non autorisé par la prestation reste choisissable : la spec
 * parle de signalement, pas de refus. Le désactiver reviendrait à interdire
 * à l'utilisateur de décrire ce qu'il a réellement fait.
 */
export function CellForm({
  date,
  etat,
  line,
  slots,
  onSubmit,
  onDelete,
  onCancel,
}: {
  /** 'YYYY-MM-DD' */
  date: string
  etat: CellState
  line: LineForGrid
  slots: Slot[]
  onSubmit: (minutes: number, slotId: string) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const [heures, setHeures] = useState(() => dureeInitiale(etat, line.minutesParJour, slots))
  const [slotId, setSlotId] = useState(() => creneauInitial(etat))
  const [erreur, setErreur] = useState<string | null>(null)

  const creneauSignale = !isSlotAllowed(slotId, line.allowedSlotIds)
  const eclatee = etat.kind === 'LIBRE' && etat.eclatee

  function valider(): void {
    const minutes = parseQuantity(heures, 'HEURE', line.minutesParJour)
    if (minutes === null || minutes <= 0 || minutes > 1440) {
      setErreur('Indiquez une durée comprise entre 1 minute et 24 heures.')
      return
    }
    setErreur(null)
    onSubmit(minutes, slotId)
  }

  return (
    <div
      role="dialog"
      aria-label={`Saisie libre du ${date}`}
      className="mt-3 rounded-md border border-rule bg-surface p-3 text-sm shadow-card"
    >
      <p className="mb-2 font-medium text-ink">Saisie du {date}</p>

      {eclatee && (
        <p
          data-testid="avertissement-eclatee"
          role="status"
          className="mb-2 rounded-md border border-warning-edge bg-warning px-2 py-1 text-xs text-warning-ink"
        >
          Cette journée est saisie en plusieurs créneaux. Enregistrer la remplacera par une
          seule saisie.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <Field
          label="Durée (heures)"
          value={heures}
          onChange={(ev) => setHeures(ev.target.value)}
          placeholder="3,5 ou 3h30"
          className="w-32"
        />

        <Select
          label="Créneau"
          value={slotId}
          onChange={(ev) => setSlotId(ev.target.value)}
          className="w-52"
        >
          <option value="">Journée entière</option>
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {isSlotAllowed(s.id, line.allowedSlotIds)
                ? s.label
                : `${s.label} (hors créneaux autorisés)`}
            </option>
          ))}
        </Select>
      </div>

      {creneauSignale && (
        <p
          data-testid="signalement-creneau"
          role="status"
          className="mt-2 rounded-md border border-warning-edge bg-warning px-2 py-1 text-xs text-warning-ink"
        >
          Ce créneau n’est pas autorisé sur cette prestation. La saisie sera tout de même
          enregistrée.
        </p>
      )}

      {erreur !== null && (
        <p role="alert" className="mt-2 text-xs text-danger-ink">
          {erreur}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <Button type="button" variant="primary" onClick={valider}>
          Enregistrer
        </Button>
        {etat.kind !== 'VIDE' && (
          <Button type="button" variant="danger" onClick={onDelete}>
            Supprimer la saisie
          </Button>
        )}
        <Button type="button" variant="quiet" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </div>
  )
}
