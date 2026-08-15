'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { formatQuantity } from '@/core/time/units'
import type { MonthDay } from '@/core/month/build'
import type { TimeEntryKind } from '@/core/types'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals, MonthEntry } from '@/services/time-entries'
import { EngagementBar } from './EngagementBar'
import { TotalsRow } from './TotalsRow'
import { useDragSelect } from './useDragSelect'

const AUCUN_TOTAL: LineEngagementTotals = []

const CELLULE_CRENEAUX =
  'Journée saisie par créneaux : la cellule agrège plusieurs créneaux et ne se modifie pas ici.'

interface Cell {
  lineId: string
  minutes: number
  kind: TimeEntryKind
  /** vrai dès qu'une des saisies agrégées porte un créneau */
  hasSlots: boolean
}

function cellKey(lineId: string, date: string): string {
  return `${lineId}|${date}`
}

/**
 * Agrège les saisies par (ligne, jour).
 *
 * La clé d'unicité d'une saisie est `(ligne, user, date, créneau)` : plusieurs
 * créneaux peuvent coexister le même jour sur la même ligne. Indexer sur
 * `(ligne, date)` en écrasant ferait disparaître une saisie de la grille tout
 * en la laissant dans la ligne de totaux.
 */
function buildCells(entries: MonthEntry[]): Map<string, Cell> {
  const cells = new Map<string, Cell>()

  for (const e of entries) {
    const key = cellKey(e.lineId, e.date)
    const prev = cells.get(key)
    cells.set(key, {
      lineId: e.lineId,
      minutes: (prev?.minutes ?? 0) + e.minutes,
      // Une journée mêlant réalisé et prévisionnel se lit comme réalisée.
      kind: prev?.kind === 'REALISE' || e.kind === 'REALISE' ? 'REALISE' : 'PREVISIONNEL',
      hasSlots: (prev?.hasSlots ?? false) || e.slotId !== '',
    })
  }

  return cells
}

export function MonthGrid({
  days,
  lines,
  entries,
  engagementTotals,
  capacityMinutes,
  minutesParJour,
  onSave,
}: {
  days: MonthDay[]
  lines: LineForGrid[]
  /** saisies du mois affiché : elles alimentent la grille et les totaux */
  entries: MonthEntry[]
  /** cumul par ligne, toutes périodes confondues : il alimente l'engagement */
  engagementTotals: Record<string, LineEngagementTotals>
  capacityMinutes: number
  /** unité de référence globale (`Settings.minutesParJour`), pour les totaux */
  minutesParJour: number
  /** renvoie `true` quand la valeur a bien été enregistrée */
  onSave: (lineId: string, date: string, raw: string) => Promise<boolean>
}) {
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines])
  const cells = useMemo(() => buildCells(entries), [entries])

  // Valeurs telles que le serveur les connaît : ce sont elles qu'on restaure
  // quand un enregistrement est refusé.
  const serverValues = useMemo(() => {
    const values = new Map<string, string>()
    for (const [key, cell] of cells) {
      const line = lineById.get(cell.lineId)
      if (line === undefined) continue
      values.set(key, formatQuantity(cell.minutes, line.displayUnit, line.minutesParJour))
    }
    return values
  }, [cells, lineById])

  // Cellules contrôlées : un input non contrôlé garde à l'écran une valeur
  // refusée par le serveur, et ne se met pas à jour lors d'un remplissage par
  // glissement.
  const [values, setValues] = useState(serverValues)
  const [seed, setSeed] = useState(serverValues)
  const editing = useRef<string | null>(null)

  if (seed !== serverValues) {
    setSeed(serverValues)
    // La cellule en cours d'édition garde sa frappe : l'enregistrement d'une
    // autre cellule provoque un rafraîchissement serveur qui ne doit pas
    // l'effacer sous les doigts de l'utilisateur.
    setValues((prev) => {
      const key = editing.current
      const enCours = key === null ? undefined : prev.get(key)
      if (key === null || enCours === undefined) return serverValues
      return new Map(serverValues).set(key, enCours)
    })
  }

  const setCell = useCallback((key: string, value: string) => {
    setValues((prev) => new Map(prev).set(key, value))
  }, [])

  const commit = useCallback(
    async (lineId: string, date: string, raw: string) => {
      const key = cellKey(lineId, date)
      // Réécrire une cellule agrégeant des créneaux créerait une saisie
      // supplémentaire à créneau vide, qui doublerait le total du jour.
      if (cells.get(key)?.hasSlots === true) {
        setCell(key, serverValues.get(key) ?? '')
        return
      }

      setCell(key, raw)
      const saved = await onSave(lineId, date, raw)
      if (!saved) setCell(key, serverValues.get(key) ?? '')
    },
    [cells, onSave, serverValues, setCell],
  )

  const drag = useDragSelect((sel, raw) => {
    for (const date of sel.dates) void commit(sel.lineId, date, raw)
  })

  return (
    <div className="overflow-x-auto">
      <div className="mb-3 flex flex-col gap-1">
        {lines.map((l) => (
          <EngagementBar key={l.id} line={l} totals={engagementTotals[l.id] ?? AUCUN_TOTAL} />
        ))}
      </div>

      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-white px-2 py-1 text-left">
              Ligne
            </th>
            {days.map((d) => (
              <th
                key={d.date}
                scope="col"
                data-testid={`day-header-${d.date}`}
                className={`w-9 px-1 py-1 text-center text-xs font-normal ${
                  d.isWorking && !d.isHoliday ? '' : 'bg-slate-100'
                }`}
              >
                {Number(d.date.slice(8))}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t">
              <th scope="row" className="sticky left-0 bg-white px-2 py-1 text-left font-normal">
                {l.label}
              </th>
              {days.map((d) => {
                const key = cellKey(l.id, d.date)
                const cell = cells.get(key)
                const parCreneaux = cell?.hasSlots === true
                return (
                  <td
                    key={d.date}
                    onMouseDown={() => drag.handlers.onMouseDown(l.id, d.date)}
                    onMouseEnter={() => drag.handlers.onMouseEnter(l.id, d.date)}
                    onMouseUp={drag.handlers.onMouseUp}
                    className={`${d.isWorking && !d.isHoliday ? '' : 'bg-slate-50'} ${
                      drag.isSelected(l.id, d.date) ? 'ring-2 ring-inset ring-blue-400' : ''
                    }`}
                  >
                    <input
                      aria-label={`${l.label} ${d.date}`}
                      value={values.get(key) ?? ''}
                      readOnly={parCreneaux}
                      title={parCreneaux ? CELLULE_CRENEAUX : undefined}
                      onChange={(ev) => setCell(key, ev.target.value)}
                      onFocus={() => {
                        editing.current = key
                      }}
                      onBlur={(ev) => {
                        editing.current = null
                        void commit(l.id, d.date, ev.target.value)
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' && drag.selection && drag.selection.dates.length > 1) {
                          ev.preventDefault()
                          drag.applyToSelection(ev.currentTarget.value)
                          drag.clear()
                        }
                        if (ev.key === 'Escape') drag.clear()
                      }}
                      className={`h-8 w-9 border-0 bg-transparent text-center text-xs outline-none focus:bg-blue-50 ${
                        cell?.kind === 'PREVISIONNEL' ? 'text-slate-400 italic' : ''
                      } ${parCreneaux ? 'bg-amber-50 text-amber-800' : ''}`}
                    />
                  </td>
                )
              })}
            </tr>
          ))}

          <TotalsRow
            days={days}
            entries={entries}
            capacityMinutes={capacityMinutes}
            minutesParJour={minutesParJour}
          />
        </tbody>
      </table>
    </div>
  )
}
