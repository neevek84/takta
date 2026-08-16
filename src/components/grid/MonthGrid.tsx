'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { kindDeLaJournee } from '@/core/saisie/kind'
import { OCCUPATION_TITRE } from '@/core/saisie/occupation'
import { centiemesParFacteur, formatJours, formatQuantity } from '@/core/time/units'
import type { MinutesAuFacteur } from '@/core/time/units'
import type { MonthDay } from '@/core/month/build'
import type { CapacityMode, TimeEntryKind } from '@/core/types'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals, MonthEntry } from '@/services/time-entries'
import { SegmentLegend } from '@/components/ui/SegmentLegend'
import { EngagementBar } from './EngagementBar'
import { TotalsRow } from './TotalsRow'
import { useDragSelect } from './useDragSelect'

const AUCUN_TOTAL: LineEngagementTotals = []

/**
 * Constante de module et non littéral dans la déstructuration : un `[]` écrit
 * là créerait un tableau neuf à chaque rendu et invaliderait le `useMemo` qui
 * en dérive l'ensemble des jours occupés.
 */
const AUCUNE_OCCUPATION: string[] = []

const CELLULE_CRENEAUX =
  'Journée saisie par créneaux : la cellule agrège plusieurs créneaux et ne se modifie pas ici.'

interface Cell {
  lineId: string
  /** minutes de la journée, chacune sous le facteur figé à son écriture */
  saisies: MinutesAuFacteur[]
  /** nature de chaque saisie agrégée ; celle de la journée en dérive */
  kinds: TimeEntryKind[]
  /** vrai dès qu'une des saisies agrégées porte un créneau */
  hasSlots: boolean
}

function cellKey(lineId: string, date: string): string {
  return `${lineId}|${date}`
}

type EtatJour = 'ouvre' | 'weekend' | 'ferie'

function etatJour(d: MonthDay): EtatJour {
  if (d.isHoliday) return 'ferie'
  return d.isWorking ? 'ouvre' : 'weekend'
}

// Fond ET motif : la teinte porte la lecture rapide, le motif porte
// l'information pour qui ne la distingue pas.
const FOND_JOUR: Record<EtatJour, string> = {
  ouvre: 'bg-surface',
  weekend: 'bg-off pattern-stripes',
  ferie: 'bg-off-strong pattern-dots',
}

const TITRE_JOUR: Record<EtatJour, string | undefined> = {
  ouvre: undefined,
  weekend: 'Jour non ouvré',
  ferie: 'Jour férié',
}

/**
 * L'occupation s'ajoute à l'état du jour, elle ne le remplace pas : un
 * dimanche occupé reste un dimanche, et écraser le titre effacerait la seule
 * chose que la colonne disait déjà.
 */
function titreEntete(etat: EtatJour, occupe: boolean): string | undefined {
  const parties = [TITRE_JOUR[etat], occupe ? OCCUPATION_TITRE : undefined].filter(
    (t) => t !== undefined,
  )
  return parties.length === 0 ? undefined : parties.join(' — ')
}

type EtatSaisie = 'vide' | 'realise' | 'previsionnel'

/**
 * La nature de la journée, jamais déduite ici : `kindDeLaJournee` la tranche
 * pour les deux vues à la fois. Le calendrier la lisait dans l'autre sens —
 * une journée mixte s'affichait prévisionnelle chez lui et réalisée ici.
 */
function etatSaisie(cell: Cell | undefined): EtatSaisie {
  if (cell === undefined) return 'vide'
  return kindDeLaJournee(cell.kinds) === 'REALISE' ? 'realise' : 'previsionnel'
}

function minutesTotales(saisies: readonly MinutesAuFacteur[]): number {
  return saisies.reduce((somme, s) => somme + s.minutes, 0)
}

/**
 * La quantité qu'une cellule affiche.
 *
 * En heures, aucun facteur n'intervient : les minutes s'additionnent. En
 * journées, chaque saisie se convertit sous le facteur figé à son écriture —
 * c'est le rôle de `centiemesParFacteur` — et non la somme des minutes sous le
 * facteur courant de la ligne : une journée écrite en deux temps à 7 h puis à
 * 8 h vaut 0,75 j, pas 0,72 j. Le calendrier affiche la même chose par le même
 * chemin.
 */
function quantiteAffichee(cell: Cell, line: LineForGrid): string {
  if (line.displayUnit === 'HEURE') {
    return formatQuantity(minutesTotales(cell.saisies), 'HEURE', line.minutesParJour)
  }
  return formatJours(centiemesParFacteur(cell.saisies))
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
      // Les saisies sont conservées une à une, jamais sommées ici : chacune
      // porte le facteur figé à son écriture, et les additionner avant de
      // convertir écraserait cette distinction.
      saisies: [...(prev?.saisies ?? []), { minutes: e.minutes, minutesParJour: e.minutesParJour }],
      // De même pour les natures : `kindDeLaJournee` tranche, et elle tranche
      // pour les deux vues à la fois.
      kinds: [...(prev?.kinds ?? []), e.kind],
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
  capacityCentiemes,
  capacityMode,
  busyDates = AUCUNE_OCCUPATION,
  onSave,
}: {
  days: MonthDay[]
  lines: LineForGrid[]
  /** saisies du mois affiché : elles alimentent la grille et les totaux */
  entries: MonthEntry[]
  /** cumul par ligne, toutes périodes confondues : il alimente l'engagement */
  engagementTotals: Record<string, LineEngagementTotals>
  /**
   * capacité d'une journée en centièmes de jour, telle qu'elle est réglée.
   *
   * Jamais convertie en minutes : la ligne de totaux compare des journées, et
   * les saisies qu'elle additionne n'ont pas toutes la même durée de journée.
   */
  capacityCentiemes: number
  /**
   * mode de capacité réglé, transmis tel quel à la ligne de totaux.
   *
   * Sans lui, la grille marquait un dépassement en mode `DESACTIVE`, que le
   * service ignore : l'écran et le service disaient deux choses de la même
   * journée.
   */
  capacityMode: CapacityMode
  /**
   * jours du mois porteurs d'une occupation dans l'agenda externe.
   *
   * Facultatif, et vide par défaut : l'agenda injoignable est le cas nominal,
   * pas une anomalie. Un jour marqué reste saisissable — le marquage informe,
   * il n'interdit rien.
   */
  busyDates?: string[]
  /** renvoie `true` quand la valeur a bien été enregistrée */
  onSave: (lineId: string, date: string, raw: string) => Promise<boolean>
}) {
  const occupes = useMemo(() => new Set(busyDates), [busyDates])
  const lineById = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines])
  const cells = useMemo(() => buildCells(entries), [entries])

  // Valeurs telles que le serveur les connaît : ce sont elles qu'on restaure
  // quand un enregistrement est refusé.
  const serverValues = useMemo(() => {
    const values = new Map<string, string>()
    for (const [key, cell] of cells) {
      const line = lineById.get(cell.lineId)
      if (line === undefined) continue
      values.set(key, quantiteAffichee(cell, line))
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
        {/* Les bandeaux dessinent deux segments, et les colonnes trois états
            de jour ; sans légende, rien ne dit lequel est lequel ailleurs
            qu'au survol de la souris — donc jamais au clavier ni au tactile. */}
        <SegmentLegend className="mb-1" />
        <p
          data-testid="legende-jours"
          className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
        >
          {(['weekend', 'ferie'] as const).map((etat) => (
            <span key={etat} className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className={`inline-block h-3 w-4 rounded-sm border border-rule ${FOND_JOUR[etat]}`}
              />
              {TITRE_JOUR[etat]}
            </span>
          ))}
          {/* Seulement quand il y a quelque chose à nommer : une légende qui
              annonce un marquage absent de la grille égare plus qu'elle
              n'aide, et l'agenda injoignable est un cas ordinaire. */}
          {occupes.size > 0 && (
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-4 rounded-sm border border-rule border-b-2 border-b-accent-dark bg-surface"
              />
              {OCCUPATION_TITRE}
            </span>
          )}
        </p>
        {lines.map((l) => (
          <EngagementBar key={l.id} line={l} totals={engagementTotals[l.id] ?? AUCUN_TOTAL} />
        ))}
      </div>

      <table className="border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-surface px-2 py-1 text-left">
              Ligne
            </th>
            {days.map((d) => {
              const occupe = occupes.has(d.date)
              return (
                <th
                  key={d.date}
                  scope="col"
                  data-testid={`day-header-${d.date}`}
                  data-jour={etatJour(d)}
                  data-busy={occupe ? 'true' : undefined}
                  title={titreEntete(etatJour(d), occupe)}
                  // Un liseré et non un fond : le fond porte déjà l'état du
                  // jour, et un aplat de plus l'effacerait. Le liseré est une
                  // différence de forme, lisible sans distinguer les teintes.
                  className={`w-11 px-1 py-1 text-center text-xs font-normal text-ink ${
                    FOND_JOUR[etatJour(d)]
                  } ${occupe ? 'border-b-2 border-b-accent-dark' : ''}`}
                >
                  {Number(d.date.slice(8))}
                  {/* Ni le liseré ni le `title` n'existent pour un lecteur
                      d'écran, et l'occupation ne se déduit pas de la date
                      comme le week-end : elle se dit. */}
                  {occupe && <span className="sr-only"> — {OCCUPATION_TITRE}</span>}
                </th>
              )
            })}
          </tr>
        </thead>

        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-rule">
              <th scope="row" className="sticky left-0 bg-surface px-2 py-1 text-left font-normal">
                {l.label}
              </th>
              {days.map((d) => {
                const key = cellKey(l.id, d.date)
                const cell = cells.get(key)
                const parCreneaux = cell?.hasSlots === true
                return (
                  <td
                    key={d.date}
                    data-jour={etatJour(d)}
                    onMouseDown={() => drag.handlers.onMouseDown(l.id, d.date)}
                    onMouseEnter={() => drag.handlers.onMouseEnter(l.id, d.date)}
                    onMouseUp={drag.handlers.onMouseUp}
                    className={`${FOND_JOUR[etatJour(d)]} ${
                      drag.isSelected(l.id, d.date) ? 'ring-2 ring-inset ring-focus' : ''
                    }`}
                  >
                    <input
                      aria-label={`${l.label} ${d.date}`}
                      data-saisie={etatSaisie(cell)}
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
                      // L'input recouvre exactement toute la cellule (`w-11` +
                      // `touch-target`, `<td>` sans rembourrage) : tout fond
                      // opaque posé ici efface le fond ET le motif du jour.
                      // Le focus se voit par le contour de `globals.css`, et
                      // les créneaux par un liseré — jamais par un aplat.
                      className={`touch-target w-11 border-0 bg-transparent text-center text-xs text-ink ${
                        etatSaisie(cell) === 'previsionnel' ? 'pattern-hatch italic text-muted' : ''
                      } ${parCreneaux ? 'text-warning-ink ring-1 ring-inset ring-warning-edge' : ''}`}
                    />
                  </td>
                )
              })}
            </tr>
          ))}

          <TotalsRow
            days={days}
            entries={entries}
            capacityCentiemes={capacityCentiemes}
            capacityMode={capacityMode}
          />
        </tbody>
      </table>
    </div>
  )
}
