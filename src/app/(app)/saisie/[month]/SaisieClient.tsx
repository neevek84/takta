'use client'

import { useEffect, useState } from 'react'
import { MonthGrid } from '@/components/grid/MonthGrid'
import { MonthCalendar } from '@/components/calendar/MonthCalendar'
import { CellForm } from '@/components/calendar/CellForm'
import { LineSelector } from '@/components/calendar/LineSelector'
import { readSelection } from '@/components/calendar/selection-storage'
import { resolveSelection } from '@/core/saisie/selection'
import { formatClearReport, formatFillReport } from '@/core/saisie/report'
import { Banner } from '@/components/ui/Banner'
import { Button } from '@/components/ui/Button'
import type { CellState } from '@/core/saisie/cycle'
import type { MonthDay } from '@/core/month/build'
import type { Slot } from '@/core/time/slots'
import type { CapacityMode } from '@/core/types'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals, MonthEntry } from '@/services/time-entries'
import { appliquerCase, remplirMois, saveCell, viderMois } from './actions'

/**
 * Centièmes de jour → jours, comme la charge et l'engagement les affichent
 * déjà. Le contrôle de capacité raisonne dans cette unité : le message la
 * reprend plutôt que de reconvertir en heures avec un facteur qu'il n'a pas.
 *
 * Pas `formatJours` : celui-ci laisse le zéro vide, ce qui écrirait ici « pour
 * une capacité de  j » quand la capacité est réglée à zéro.
 */
function jours(centiemes: number): string {
  return String(centiemes / 100).replace('.', ',')
}

type Vue = 'CALENDRIER' | 'TABLEAU'

export function SaisieClient(props: {
  month: string
  days: MonthDay[]
  lines: LineForGrid[]
  entries: MonthEntry[]
  engagementTotals: Record<string, LineEngagementTotals>
  capacityCentiemes: number
  capacityMode: CapacityMode
  slots: Slot[]
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [vue, setVue] = useState<Vue>('CALENDRIER')
  const [toutLeMois, setToutLeMois] = useState(false)
  const [confirmationVidage, setConfirmationVidage] = useState(false)
  const [formulaire, setFormulaire] = useState<{ date: string; etat: CellState } | null>(null)

  // La sélection mémorisée ne peut être lue qu'après le montage : la lire dans
  // l'initialiseur ferait diverger le rendu serveur du rendu client.
  const [lineId, setLineId] = useState(() => resolveSelection(props.lines, null)?.lineId ?? '')
  useEffect(() => {
    const memorise = resolveSelection(props.lines, readSelection())?.lineId
    if (memorise !== undefined) setLineId(memorise)
  }, [props.lines])

  const ligne = props.lines.find((l) => l.id === lineId)

  /** Renvoie `true` quand la valeur a bien été enregistrée. — vue tableau */
  async function handleSave(lineIdCellule: string, date: string, raw: string): Promise<boolean> {
    const kind = date >= new Date().toISOString().slice(0, 10) ? 'PREVISIONNEL' : 'REALISE'

    const r = await saveCell({ lineId: lineIdCellule, date, raw, kind, month: props.month })

    if (r.ok) {
      // Mode AVERTISSEMENT : la saisie est conservée, le dépassement signalé.
      setMessage(
        r.warning
          ? `Capacité dépassée le ${date} : ${jours(r.warning.totalCentiemes)} j saisis pour une capacité de ${jours(r.warning.capacityCentiemes)} j. La saisie est conservée.`
          : null,
      )
      return true
    }

    setMessage(messageDeRefus(r, date, 'cette ligne de prestation'))
    return false
  }

  /** Renvoie `true` quand l'état a bien été enregistré. — vue calendrier */
  async function handleApply(date: string, state: CellState): Promise<boolean> {
    const r = await appliquerCase({ lineId, date, state, month: props.month })

    if (r.ok) {
      // Le signalement de créneau prime : il dit ce que la saisie a de
      // particulier, là où l'avertissement de capacité redit ce que la ligne
      // de totaux montre déjà.
      setMessage(
        r.signalement ??
          (r.warning
            ? `Capacité dépassée le ${date} : ${jours(r.warning.totalCentiemes)} j saisis pour une capacité de ${jours(r.warning.capacityCentiemes)} j. La saisie est conservée.`
            : null),
      )
      return true
    }

    setMessage(messageDeRefus(r, date, 'cette prestation'))
    return false
  }

  async function handleRange(dates: string[], state: CellState): Promise<void> {
    // Séquentiel et non `Promise.all` : chaque jour est contrôlé contre la
    // capacité du jour, et les lancer de front ferait juger chacun sur un
    // total que les autres n'ont pas encore modifié.
    for (const date of dates) await handleApply(date, state)
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          aria-pressed={vue === 'CALENDRIER'}
          variant={vue === 'CALENDRIER' ? 'primary' : 'secondary'}
          onClick={() => setVue('CALENDRIER')}
        >
          Calendrier
        </Button>
        {/* Sept colonnes tiennent sur un téléphone ; trente et une, non. La
            vue calendrier, elle, reste offerte sur les deux. */}
        <Button
          type="button"
          aria-pressed={vue === 'TABLEAU'}
          variant={vue === 'TABLEAU' ? 'primary' : 'secondary'}
          onClick={() => setVue('TABLEAU')}
          className="hidden md:inline-flex"
        >
          Tableau
        </Button>

        {/* Séparateur tracé par un filet et non par un aplat : un fond de
            jeton doit porter une encre déclarée, ce que ce trait n'a pas. */}
        <span className="mx-2 h-5 w-0 border-l border-rule" aria-hidden="true" />

        {/* Portée de ce que le calendrier montre : la prestation saisie seule,
            ou toutes celles du mois en lecture seule à côté d'elle. */}
        <Button
          type="button"
          aria-pressed={!toutLeMois}
          variant={toutLeMois ? 'secondary' : 'primary'}
          onClick={() => setToutLeMois(false)}
        >
          Cette prestation
        </Button>
        <Button
          type="button"
          aria-pressed={toutLeMois}
          variant={toutLeMois ? 'primary' : 'secondary'}
          onClick={() => setToutLeMois(true)}
        >
          Tout le mois
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <LineSelector lines={props.lines} lineId={lineId} onChange={setLineId} />

        {ligne !== undefined && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={async () => {
                setMessage(formatFillReport(await remplirMois({ lineId, month: props.month })))
              }}
            >
              Remplir le CRA
            </Button>
            <Button type="button" onClick={() => setConfirmationVidage(true)}>
              Vider le CRA
            </Button>
          </div>
        )}
      </div>

      {/* C'est destructeur et ça doit se dire. Un panneau en ligne plutôt que
          `window.confirm`, qui bloque le fil et n'existe pas au test. */}
      {confirmationVidage && ligne !== undefined && (
        <div className="mb-3">
          <Banner tone="danger" title={`Vider le CRA de « ${ligne.label} » sur ${props.month} ?`}>
            <p className="mb-2">
              Toutes les saisies de cette prestation sur ce mois seront retirées. Cette action est
              irréversible.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="danger"
                onClick={async () => {
                  setConfirmationVidage(false)
                  setMessage(formatClearReport(await viderMois({ lineId, month: props.month })))
                }}
              >
                Confirmer le vidage
              </Button>
              <Button type="button" variant="quiet" onClick={() => setConfirmationVidage(false)}>
                Annuler le vidage
              </Button>
            </div>
          </Banner>
        </div>
      )}

      {message !== null && (
        <div className="mb-3">
          <Banner tone="warning">{message}</Banner>
        </div>
      )}

      {vue === 'CALENDRIER' && ligne !== undefined && (
        <>
          <MonthCalendar
            days={props.days}
            line={ligne}
            slots={props.slots}
            entries={props.entries}
            autresLignes={props.lines.filter((l) => l.id !== ligne.id)}
            toutLeMois={toutLeMois}
            onApply={handleApply}
            onRange={handleRange}
            onFormulaire={(date, etat) => setFormulaire({ date, etat })}
          />
          {formulaire !== null && (
            <CellForm
              date={formulaire.date}
              etat={formulaire.etat}
              line={ligne}
              slots={props.slots}
              onSubmit={async (minutes, slotId) => {
                setFormulaire(null)
                await handleApply(formulaire.date, {
                  kind: 'LIBRE',
                  minutes,
                  slotId,
                  eclatee: false,
                })
              }}
              onDelete={async () => {
                setFormulaire(null)
                await handleApply(formulaire.date, { kind: 'VIDE' })
              }}
              onCancel={() => setFormulaire(null)}
            />
          )}
        </>
      )}

      {vue === 'TABLEAU' && (
        <MonthGrid
          days={props.days}
          lines={props.lines}
          entries={props.entries}
          engagementTotals={props.engagementTotals}
          capacityCentiemes={props.capacityCentiemes}
          capacityMode={props.capacityMode}
          onSave={handleSave}
        />
      )}
    </>
  )
}

/**
 * Le refus, dit en français. Les deux vues partagent les mêmes raisons de
 * refus : les formuler deux fois les ferait diverger au premier ajout.
 */
function messageDeRefus(
  r:
    | { ok: false; reason: 'CAPACITE'; totalCentiemes: number; capacityCentiemes: number }
    | { ok: false; reason: 'VERROUILLE' }
    | { ok: false; reason: 'NON_AFFECTE' }
    | { ok: false; reason: 'SAISIE_INVALIDE' },
  date: string,
  quoi: string,
): string {
  if (r.reason === 'CAPACITE') {
    return `Capacité dépassée le ${date} : ${jours(r.totalCentiemes)} j saisis pour une capacité de ${jours(r.capacityCentiemes)} j. La saisie est refusée.`
  }
  if (r.reason === 'VERROUILLE') {
    return `Le CRA de ce mois est validé. Rouvrez-le pour modifier la saisie.`
  }
  if (r.reason === 'NON_AFFECTE') return `Vous n'êtes pas affecté à ${quoi}.`
  return `Saisie invalide.`
}
