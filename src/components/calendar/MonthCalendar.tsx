'use client'

import { useCallback, useMemo, useState } from 'react'
import { buildWeeks } from '@/core/month/weeks'
import { buildCellStates } from '@/core/saisie/cell-state'
import { colorForLine } from '@/core/saisie/colors'
import { cycleSlotIds, nextCellState } from '@/core/saisie/cycle'
import type { CellState } from '@/core/saisie/cycle'
import { formatQuantity } from '@/core/time/units'
import type { MonthDay } from '@/core/month/build'
import type { Slot } from '@/core/time/slots'
import { Button } from '@/components/ui/Button'
import { useDragSelect } from '@/components/grid/useDragSelect'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'
import { useLongPress } from './useLongPress'

const VIDE: CellState = { kind: 'VIDE' }

const EN_TETES = [
  { dayOfWeek: 1, court: 'L', long: 'Lun' },
  { dayOfWeek: 2, court: 'M', long: 'Mar' },
  { dayOfWeek: 3, court: 'M', long: 'Mer' },
  { dayOfWeek: 4, court: 'J', long: 'Jeu' },
  { dayOfWeek: 5, court: 'V', long: 'Ven' },
  { dayOfWeek: 6, court: 'S', long: 'Sam' },
  { dayOfWeek: 7, court: 'D', long: 'Dim' },
]

type EtatJour = 'ouvre' | 'weekend' | 'ferie'

function etatJour(d: MonthDay): EtatJour {
  if (d.isHoliday) return 'ferie'
  return d.isWorking ? 'ouvre' : 'weekend'
}

// Fond ET motif, comme dans la grille : la teinte porte la lecture rapide, le
// motif porte l'information pour qui ne la distingue pas. Aucune couleur en
// dur — ce sont les jetons `off` / `off-strong` / `surface` du thème.
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

function libelleSlot(slotId: string, slots: readonly Slot[]): string {
  return slots.find((s) => s.id === slotId)?.label ?? slotId
}

/** Ce que la case affiche. Aucune conversion maison : `formatQuantity` sait le faire. */
function contenu(etat: CellState, slots: readonly Slot[], minutesParJour: number): string {
  switch (etat.kind) {
    case 'VIDE':
      return ''
    case 'JOURNEE':
      return '1'
    case 'DEMI':
      return `½ ${libelleSlot(etat.slotId, slots).slice(0, 1).toUpperCase()}`
    case 'LIBRE':
      return formatQuantity(etat.minutes, 'HEURE', minutesParJour)
  }
}

function description(etat: CellState, slots: readonly Slot[]): string {
  switch (etat.kind) {
    case 'VIDE':
      return 'Aucune saisie'
    case 'JOURNEE':
      return 'Journée entière'
    case 'DEMI':
      return `Demi-journée — ${libelleSlot(etat.slotId, slots)}`
    case 'LIBRE':
      return etat.eclatee
        ? 'Journée saisie en plusieurs créneaux'
        : `Durée libre${etat.slotId === '' ? '' : ` — ${libelleSlot(etat.slotId, slots)}`}`
  }
}

/**
 * La vue mensuelle : sept colonnes, une case par jour, un clic par cran.
 *
 * Le composant ne décide de rien — il demande à `nextCellState` ce que le clic
 * signifie et transmet le résultat. Aucune règle de capacité, d'engagement ni
 * de conversion d'unité ne vit ici.
 */
export function MonthCalendar({
  days,
  line,
  slots,
  entries,
  autresLignes,
  toutLeMois,
  onApply,
  onRange,
  onFormulaire,
}: {
  days: MonthDay[]
  /** la prestation saisie : la seule que ce composant rend cliquable */
  line: LineForGrid
  slots: Slot[]
  entries: MonthEntry[]
  /** autres prestations, affichées en lecture seule quand `toutLeMois` */
  autresLignes: LineForGrid[]
  toutLeMois: boolean
  /** renvoie `true` quand l'état a bien été enregistré */
  onApply: (date: string, state: CellState) => Promise<boolean>
  onRange: (dates: string[], state: CellState) => Promise<void>
  onFormulaire: (date: string, etat: CellState) => void
}) {
  const semaines = useMemo(() => buildWeeks(days), [days])

  const ctx = useMemo(
    () => ({ minutesParJour: line.minutesParJour, slots }),
    [line.minutesParJour, slots],
  )
  const options = useMemo(
    () => ({ demiSlotIds: cycleSlotIds(slots, line.allowedSlotIds), displayUnit: line.displayUnit }),
    [slots, line.allowedSlotIds, line.displayUnit],
  )

  const serveur = useMemo(() => buildCellStates(entries, line.id, ctx), [entries, line.id, ctx])

  // Le `kind` ne rentre pas dans `CellState` : il dit comment la case
  // s'affiche, jamais ce que le clic suivant écrit.
  const previsionnelles = useMemo(
    () =>
      new Set(
        entries.filter((e) => e.lineId === line.id && e.kind === 'PREVISIONNEL').map((e) => e.date),
      ),
    [entries, line.id],
  )

  // Affichage optimiste : le cran suivant s'affiche avant l'aller-retour
  // serveur, et disparaît si l'écriture est refusée.
  const [optimiste, setOptimiste] = useState<Map<string, CellState>>(new Map())
  const [seed, setSeed] = useState(serveur)
  if (seed !== serveur) {
    setSeed(serveur)
    setOptimiste(new Map())
  }

  const etatDe = useCallback(
    (date: string): CellState => optimiste.get(date) ?? serveur.get(date) ?? VIDE,
    [optimiste, serveur],
  )

  // Les autres prestations ne servent qu'à voir si un jour est déjà pris
  // ailleurs : on n'a besoin que de leur présence, jamais de leur détail.
  const autresParDate = useMemo(() => {
    if (!toutLeMois) return new Map<string, LineForGrid[]>()

    const parId = new Map(autresLignes.map((l) => [l.id, l]))
    const parDate = new Map<string, LineForGrid[]>()
    for (const e of entries) {
      const autre = parId.get(e.lineId)
      if (autre === undefined || e.minutes === 0) continue
      const bucket = parDate.get(e.date)
      if (bucket === undefined) parDate.set(e.date, [autre])
      else if (!bucket.some((l) => l.id === autre.id)) bucket.push(autre)
    }
    return parDate
  }, [toutLeMois, autresLignes, entries])

  // `useDragSelect` applique une chaîne brute dans la vue tableau ; ici on ne
  // se sert que de la plage qu'il calcule, l'état à appliquer venant des
  // boutons de la barre.
  const drag = useDragSelect(() => {})
  const plage = drag.selection?.dates ?? []
  const barreVisible = plage.length > 1

  const appliquerPlage = useCallback(
    async (state: CellState) => {
      const dates = drag.selection?.dates ?? []
      drag.clear()
      if (dates.length === 0) return
      // Optimiste sur toute la plage, comme sur une case seule.
      setOptimiste((prev) => {
        const suivant = new Map(prev)
        for (const date of dates) suivant.set(date, state)
        return suivant
      })
      await onRange(dates, state)
    },
    [drag, onRange],
  )

  const cliquer = useCallback(
    async (date: string) => {
      const etat = etatDe(date)
      const step = nextCellState(etat, options)

      if (step.action === 'FORMULAIRE') {
        onFormulaire(date, etat)
        return
      }

      setOptimiste((prev) => new Map(prev).set(date, step.state))
      const enregistre = await onApply(date, step.state)
      if (!enregistre) {
        setOptimiste((prev) => {
          const suivant = new Map(prev)
          suivant.delete(date)
          return suivant
        })
      }
    },
    [etatDe, onFormulaire, onApply, options],
  )

  return (
    <div>
      <p className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {/* Les fonds de week-end et de férié ne se lisent pas sans légende : la
            teinte et le motif y renvoient, ils ne se nomment pas eux-mêmes. */}
        {(['weekend', 'ferie'] as const).map((etat) => (
          <span key={etat} className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className={`inline-block h-3 w-4 rounded-sm border border-rule ${FOND_JOUR[etat]}`}
            />
            {TITRE_JOUR[etat]}
          </span>
        ))}
      </p>

      <div data-testid="grille-calendrier" className="grid grid-cols-7 gap-1">
        {EN_TETES.map((e) => (
          <div
            key={e.dayOfWeek}
            data-testid={`entete-jour-${e.dayOfWeek}`}
            className="py-1 text-center text-xs font-medium text-muted"
          >
            <span className="sm:hidden">{e.court}</span>
            <span className="hidden sm:inline">{e.long}</span>
          </div>
        ))}

        {semaines.map((semaine, i) =>
          semaine.map((jour, j) =>
            jour === null ? (
              <div key={`vide-${i}-${j}`} aria-hidden="true" className="touch-target" />
            ) : (
              <Case
                key={jour.date}
                jour={jour}
                etat={etatDe(jour.date)}
                previsionnel={previsionnelles.has(jour.date)}
                autres={autresParDate.get(jour.date) ?? []}
                selected={drag.isSelected(line.id, jour.date)}
                slots={slots}
                minutesParJour={line.minutesParJour}
                label={line.label}
                onClick={() => void cliquer(jour.date)}
                onFormulaire={() => onFormulaire(jour.date, etatDe(jour.date))}
                dragHandlers={{
                  onMouseDown: () => drag.handlers.onMouseDown(line.id, jour.date),
                  onMouseEnter: () => drag.handlers.onMouseEnter(line.id, jour.date),
                  onMouseUp: drag.handlers.onMouseUp,
                }}
              />
            ),
          ),
        )}
      </div>

      {barreVisible && (
        <div
          data-testid="barre-selection"
          className="mt-2 flex flex-wrap items-center gap-2 rounded border border-rule bg-off px-3 py-2 text-sm text-ink"
        >
          <span className="font-medium">{plage.length} jours sélectionnés</span>
          <Button type="button" onClick={() => void appliquerPlage({ kind: 'JOURNEE' })}>
            1 jour
          </Button>
          {options.demiSlotIds.map((slotId) => (
            <Button
              key={slotId}
              type="button"
              onClick={() => void appliquerPlage({ kind: 'DEMI', slotId })}
            >
              ½ {libelleSlot(slotId, slots)}
            </Button>
          ))}
          <Button type="button" onClick={() => void appliquerPlage({ kind: 'VIDE' })}>
            Vider ces jours
          </Button>
          <Button type="button" onClick={drag.clear}>
            Annuler la sélection
          </Button>
        </div>
      )}
    </div>
  )
}

function Case({
  jour,
  etat,
  previsionnel,
  autres,
  selected,
  slots,
  minutesParJour,
  label,
  onClick,
  onFormulaire,
  dragHandlers,
}: {
  jour: MonthDay
  etat: CellState
  previsionnel: boolean
  /** autres prestations occupant ce jour, en lecture seule */
  autres: LineForGrid[]
  selected: boolean
  slots: Slot[]
  minutesParJour: number
  label: string
  onClick: () => void
  onFormulaire: () => void
  dragHandlers: { onMouseDown: () => void; onMouseEnter: () => void; onMouseUp: () => void }
}) {
  const appuiLong = useLongPress(onFormulaire)

  // Week-ends et fériés : grisés, jamais interdits.
  const jourDit = etatJour(jour)
  const titreJour = TITRE_JOUR[jourDit]
  const detail = [titreJour, description(etat, slots)].filter((t) => t !== undefined).join(' — ')

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        data-testid={`case-${jour.date}`}
        data-jour={jourDit}
        aria-label={`${label} le ${jour.date} — ${detail}`}
        title={detail}
        {...appuiLong.handlers}
        {...dragHandlers}
        onClick={() => {
          // L'appui long a déjà ouvert le formulaire : le clic qui le suit ne
          // doit pas faire avancer la case d'un cran derrière lui.
          if (appuiLong.consommerAppuiLong()) return
          onClick()
        }}
        onContextMenu={(ev) => {
          ev.preventDefault()
          onFormulaire()
        }}
        onKeyDown={(ev) => {
          // Ni le clic droit ni l'appui long ne se produisent au clavier :
          // Maj+Entrée (tout clavier) et la touche Menu (celle qui ouvre déjà
          // le menu contextuel du système) sont les deux équivalents proposés.
          // Entrée seul, lui, continue de faire avancer la case d'un cran —
          // c'est l'activation native du bouton, laissée intacte.
          if (ev.key === 'ContextMenu' || (ev.key === 'Enter' && ev.shiftKey)) {
            ev.preventDefault()
            onFormulaire()
          }
        }}
        className={`touch-target flex flex-col items-center justify-center rounded-sm border border-rule text-sm ${
          FOND_JOUR[jourDit]
        } ${etat.kind === 'LIBRE' && etat.eclatee ? 'ring-1 ring-inset ring-warning-edge' : ''} ${
          etat.kind === 'VIDE' ? 'text-muted' : 'text-ink'
        } ${previsionnel ? 'pattern-hatch italic text-muted' : ''} ${
          selected ? 'ring-2 ring-inset ring-focus' : ''
        }`}
      >
        <span className="text-xs leading-none text-muted">{Number(jour.date.slice(8))}</span>
        {/* Le numéro du jour et la valeur sont deux nœuds distincts : les mêler
            rendrait « la case est vide » indistinguable de « la case affiche 10 ». */}
        <span data-testid={`valeur-${jour.date}`} className="leading-tight">
          {contenu(etat, slots, minutesParJour)}
        </span>
      </button>
      {autres.map((a) => {
        const couleur = colorForLine(a.id)
        return (
          <span
            key={a.id}
            data-testid={`autre-${a.id}-${jour.date}`}
            title={`${a.label} — lecture seule`}
            className={`truncate rounded border px-1 text-[10px] ${couleur.bg} ${couleur.text} ${couleur.border}`}
          >
            {a.label}
          </span>
        )
      })}
    </div>
  )
}
