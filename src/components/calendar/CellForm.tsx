'use client'

import { useEffect, useRef, useState } from 'react'
import { isSlotAllowed } from '@/core/saisie/cycle'
import type { CellState } from '@/core/saisie/cycle'
import { cellStateToWrite } from '@/core/saisie/cell-state'
import { libelleCreneauAvecMoment } from '@/core/saisie/slot-labels'
import { entryBounds, minutesBetween } from '@/core/time/slots'
import type { Slot } from '@/core/time/slots'
import { formatQuantity } from '@/core/time/units'
import type { LineForGrid } from '@/services/missions'
import { Field } from '@/components/ui/Field'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'

/** Minutes depuis minuit → 'HH:MM', la valeur d'un `<input type="time">`. */
function minutesToTimeInput(minutes: number): string {
  const borne = ((minutes % 1440) + 1440) % 1440
  const h = Math.floor(borne / 60)
  const m = borne % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 'HH:MM' → minutes depuis minuit ; `null` sur une saisie inexploitable. */
function timeInputToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

/**
 * Les heures **déjà écrites** de la case, quand elle en a.
 *
 * Une valeur libre les porte directement ; une journée entière et une
 * demi-journée les portent depuis que `readCellState` les reporte. C'est le
 * défaut M1 : sans elles, le formulaire les **recalculait** depuis la plage
 * journée et les créneaux *courants*. Une saisie écrite de 8 h à 16 h
 * s'ouvrait sur 10 h – 18 h le jour où l'administrateur déplaçait la journée
 * de travail, les heures réellement enregistrées n'étaient montrées nulle
 * part, et valider sans rien changer les écrasait par celles-là. Le gel avait
 * tenu en base jusqu'à ce que le lecteur le casse.
 */
function bornesFigees(etat: CellState): { startMinute: number; endMinute: number } | undefined {
  if (etat.kind === 'LIBRE') {
    return { startMinute: etat.startMinute, endMinute: etat.endMinute }
  }
  return etat.kind === 'VIDE' ? undefined : etat.bornes
}

/**
 * Les deux bornes que le formulaire affiche à l'ouverture.
 *
 * D'abord celles que la case porte déjà, figées à son écriture. À défaut
 * seulement — une case vide, ou le cran que le clic vient de poser et dont les
 * heures n'existeront qu'à l'écriture —, celles que `cellStateToWrite`
 * calculerait des réglages courants, c'est-à-dire exactement ce qui partirait
 * en base. Jamais d'heure inventée : le défaut que ce lot corrige était
 * précisément que l'application décidait seule d'un début que rien n'affichait.
 */
function bornesInitiales(
  etat: CellState,
  line: LineForGrid,
  slots: Slot[],
  journeeDebutMinute: number,
  journeeFinMinute: number,
): { startMinute: number; endMinute: number } {
  const figees = bornesFigees(etat)
  if (figees !== undefined) return figees

  if (etat.kind === 'VIDE') {
    return { startMinute: journeeDebutMinute, endMinute: journeeFinMinute % 1440 }
  }

  const cible = cellStateToWrite(etat, {
    minutesParJour: line.minutesParJour,
    slots,
    journeeDebutMinute,
    journeeFinMinute,
  })[0]

  return cible === undefined
    ? { startMinute: journeeDebutMinute, endMinute: journeeFinMinute % 1440 }
    : { startMinute: cible.startMinute, endMinute: cible.endMinute }
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
 * Saisie d'un **début** et d'une **fin**, ouverte par appui long, clic droit,
 * ou — au clavier — Maj+Entrée ou la touche Menu sur une case (voir
 * `MonthCalendar`).
 *
 * Le formulaire demandait auparavant une durée et un créneau : saisir « 1
 * heure » sur « Matin » laissait l'application décider seule que le bloc
 * commençait à 8 h, et rien ne le disait — ni ici, ni dans l'agenda où le bloc
 * atterrissait. Le bloc a une place dans la journée, et la saisie doit la dire.
 * **La durée en découle** : elle s'affiche, elle ne se saisit plus.
 *
 * Les créneaux nommés restent, en **pré-remplissage** : choisir « Matin »
 * remplit ses deux bornes, ajustables ensuite. On garde le chemin rapide, et on
 * voit ce qui partira. Le créneau retenu reste transmis comme trace de
 * l'origine — il n'identifie plus la saisie, mais il dit d'où elle vient.
 *
 * Une fin antérieure au début n'est pas une erreur de saisie : le bloc franchit
 * minuit, ce que le porteur fait réellement certaines nuits.
 *
 * Un créneau non autorisé par la prestation reste choisissable : la spec parle
 * de signalement, pas de refus. Le désactiver reviendrait à interdire à
 * l'utilisateur de décrire ce qu'il a réellement fait.
 *
 * La boîte est rendue **après** la grille dans l'ordre du DOM : sans focus
 * déplacé, atteindre le premier champ demandait de tabuler à travers toutes les
 * cases restantes du mois — vingt et une tabulations depuis le 11 mars,
 * mesurées en revue. Le raccourci clavier qui l'ouvre et la boîte qu'il ouvre
 * sont une seule fonctionnalité : `aria-modal` la promet hors du reste du
 * document, et trois choses la rendent vraie, comme dans `ConfirmDialog` — le
 * focus entre dans le panneau, il y est retenu, il revient à la case à la
 * fermeture, et Échap referme. Échap est écouté sur le document et non sur le
 * `<div>`, qui cesserait de recevoir la touche dès que le focus le quitte.
 */
export function CellForm({
  date,
  etat,
  line,
  slots,
  journeeDebutMinute,
  journeeFinMinute,
  onSubmit,
  onDelete,
  onCancel,
}: {
  /** 'YYYY-MM-DD' */
  date: string
  etat: CellState
  line: LineForGrid
  slots: Slot[]
  /** début de la plage journée, minutes depuis minuit */
  journeeDebutMinute: number
  /** fin de la plage journée, minutes depuis minuit */
  journeeFinMinute: number
  onSubmit: (minutes: number, slotId: string, startMinute: number, endMinute: number) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const initiales = () =>
    bornesInitiales(etat, line, slots, journeeDebutMinute, journeeFinMinute)

  const [debut, setDebut] = useState(() => minutesToTimeInput(initiales().startMinute))
  const [fin, setFin] = useState(() => minutesToTimeInput(initiales().endMinute))
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

  const debutMinute = timeInputToMinutes(debut)
  const finMinute = timeInputToMinutes(fin)
  const minutes =
    debutMinute === null || finMinute === null ? null : minutesBetween(debutMinute, finMinute)

  /**
   * Le créneau **pré-remplit** les deux heures, il ne les verrouille pas.
   *
   * Les bornes viennent du créneau lui-même (`entryBounds` les lit, il ne les
   * invente pas), et la journée entière retombe sur la plage journée.
   */
  function choisirCreneau(id: string): void {
    setSlotId(id)
    const slot = id === '' ? null : (slots.find((s) => s.id === id) ?? null)
    const bornes = entryBounds({
      // Sans créneau, la plage entière : c'est un pré-remplissage, que la
      // personne rectifie. La durée réellement retenue en découlera.
      minutes: Math.max(0, journeeFinMinute - journeeDebutMinute),
      slot,
      journeeDebutMinute,
      journeeFinMinute,
    })
    setDebut(minutesToTimeInput(bornes.startMinute))
    setFin(minutesToTimeInput(bornes.endMinute))
  }

  function valider(): void {
    if (debutMinute === null || finMinute === null || minutes === null) {
      setErreur('Indiquez une heure de début et une heure de fin.')
      return
    }
    setErreur(null)
    onSubmit(minutes, slotId, debutMinute, finMinute)
  }

  return (
    <div
      ref={panneau}
      role="dialog"
      aria-modal="true"
      aria-label={`Saisie du ${date}`}
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
          label="Heure de début"
          type="time"
          value={debut}
          onChange={(ev) => setDebut(ev.target.value)}
          className="w-32"
        />

        <Field
          label="Heure de fin"
          type="time"
          value={fin}
          onChange={(ev) => setFin(ev.target.value)}
          // Le franchissement de minuit se dit, il ne se devine pas : sans
          // cette phrase, une fin avant le début se lirait comme une erreur.
          hint="Avant le début : la nuit, jusqu’au lendemain."
          className="w-32"
        />

        <Select
          label="Créneau"
          value={slotId}
          onChange={(ev) => choisirCreneau(ev.target.value)}
          className="w-52"
        >
          <option value="">Journée entière</option>
          {slots.map((s) => {
            // « AM » et « PM » ici aussi : le porteur les veut partout. Pas
            // « ½ AM » — ce formulaire écrit un bloc horaire, qui n'est pas
            // forcément une demi-journée.
            const libelle = libelleCreneauAvecMoment(s.id, slots)
            return (
              <option key={s.id} value={s.id}>
                {isSlotAllowed(s.id, line.allowedSlotIds)
                  ? libelle
                  : `${libelle} (hors créneaux autorisés)`}
              </option>
            )
          })}
        </Select>
      </div>

      {/* La durée n'est plus une saisie : elle découle des deux heures, et
          s'affiche pour que rien ne parte sans avoir été vu. `role="status"`
          l'annonce au lecteur d'écran au fil de la frappe. */}
      <p data-testid="duree-calculee" role="status" className="mt-2 text-xs text-muted">
        {minutes === null
          ? 'Durée : indiquez deux heures.'
          : `Durée : ${formatQuantity(minutes, 'HEURE', line.minutesParJour)}`}
      </p>

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
