'use client'

import { useEffect, useRef, useState } from 'react'
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

/** Mêmes cibles que `ConfirmDialog` : ce que la tabulation peut atteindre. */
const FOCALISABLES = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function focalisables(panneau: HTMLElement | null): HTMLElement[] {
  return Array.from(panneau?.querySelectorAll<HTMLElement>(FOCALISABLES) ?? [])
}

/**
 * Saisie d'une durée libre et d'un créneau, ouverte par appui long, clic
 * droit, ou — au clavier — Maj+Entrée ou la touche Menu sur une case (voir
 * `MonthCalendar`).
 *
 * Un créneau non autorisé par la prestation reste choisissable : la spec
 * parle de signalement, pas de refus. Le désactiver reviendrait à interdire
 * à l'utilisateur de décrire ce qu'il a réellement fait.
 *
 * La boîte est rendue **après** la grille dans l'ordre du DOM : sans focus
 * déplacé, atteindre le champ « Durée (heures) » demandait de tabuler à
 * travers toutes les cases restantes du mois — vingt et une tabulations
 * depuis le 11 mars, mesurées en revue. Le raccourci clavier qui l'ouvre et la
 * boîte qu'il ouvre sont une seule fonctionnalité : `aria-modal` la promet
 * hors du reste du document, et trois choses la rendent vraie, comme dans
 * `ConfirmDialog` — le focus entre dans le panneau, il y est retenu, il
 * revient à la case à la fermeture, et Échap referme. Échap est écouté sur le
 * document et non sur le `<div>`, qui cesserait de recevoir la touche dès que
 * le focus le quitte.
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

  const panneau = useRef<HTMLDivElement>(null)
  /** Élément focalisé à l'ouverture — la case du calendrier, au clavier. */
  const origine = useRef<HTMLElement | null>(null)

  // Le focus est rendu au nettoyage, donc à la fermeture comme à
  // l'enregistrement : les deux démontent la boîte.
  useEffect(() => {
    origine.current = document.activeElement as HTMLElement | null
    return () => {
      origine.current?.focus()
      origine.current = null
    }
  }, [])

  // Dépend de la date : ouvrir la boîte sur une autre case sans la refermer ne
  // remonte pas le composant, et laisserait alors le focus où il était.
  useEffect(() => {
    focalisables(panneau.current)[0]?.focus()
  }, [date])

  useEffect(() => {
    const surTouche = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        onCancel()
        return
      }
      if (ev.key !== 'Tab') return

      const cibles = focalisables(panneau.current)
      if (cibles.length === 0) return

      const premier = cibles[0]!
      const dernier = cibles[cibles.length - 1]!
      const actif = document.activeElement

      // Le focus sort du panneau : on le ramène de l'autre côté du cycle.
      if (ev.shiftKey ? actif === premier : actif === dernier) {
        ev.preventDefault()
        ;(ev.shiftKey ? dernier : premier).focus()
      } else if (actif === null || !cibles.includes(actif as HTMLElement)) {
        ev.preventDefault()
        ;(ev.shiftKey ? dernier : premier).focus()
      }
    }

    document.addEventListener('keydown', surTouche)
    return () => document.removeEventListener('keydown', surTouche)
  }, [onCancel])

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
      ref={panneau}
      role="dialog"
      aria-modal="true"
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
