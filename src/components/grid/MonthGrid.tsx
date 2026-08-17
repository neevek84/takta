'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { readCellState } from '@/core/saisie/cell-state'
import type { CellEntry } from '@/core/saisie/cell-state'
import { colorForLine, PREVU_COLOR } from '@/core/saisie/colors'
import { formeDeLaCase } from '@/core/saisie/forme'
import type { Forme } from '@/core/saisie/forme'
import { kindDeLaJournee } from '@/core/saisie/kind'
import { OCCUPATION_TITRE } from '@/core/saisie/occupation'
import { centiemesParFacteur, formatJours, formatQuantity } from '@/core/time/units'
import type { MinutesAuFacteur } from '@/core/time/units'
import type { MonthDay } from '@/core/month/build'
import type { Slot } from '@/core/time/slots'
import type { CapacityMode, TimeEntryKind } from '@/core/types'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals, MonthEntry } from '@/services/time-entries'
import { Aplat } from '@/components/ui/Aplat'
// Le même tracé que le calendrier, pris au même endroit : le liseré
// `warning-edge` portait seul l'avertissement d'éclatement, et il ne s'écarte
// que de 1,63 en L* de `prevu` en Encre clair — le préréglage par défaut — pour
// un plancher de 4. Le coin, lui, est peint de l'encre de la cellule.
import { CoinEclate } from '@/components/ui/CoinEclate'
// `SEGMENT_PREVU_BORDURE` et non un tireté réécrit ici : la légende, les
// bandeaux d'engagement et cette cellule doivent porter **les mêmes classes**,
// sinon l'un des trois dérive sans que rien ne le dise.
import { SegmentLegend, SEGMENT_PREVU_BORDURE } from '@/components/ui/SegmentLegend'
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

/** Même raison que `AUCUNE_OCCUPATION` : un littéral neuf à chaque rendu. */
const AUCUN_CRENEAU: Slot[] = []

const CELLULE_CRENEAUX =
  'Journée saisie par créneaux : la cellule agrège plusieurs créneaux et ne se modifie pas ici.'

interface Cell {
  lineId: string
  /** minutes de la journée, chacune sous le facteur figé à son écriture */
  saisies: MinutesAuFacteur[]
  /**
   * les mêmes saisies, telles que la cinématique les lit.
   *
   * Conservées à côté de `saisies` parce que le classement d'une journée —
   * entière, demie, libre — se fait sur le créneau autant que sur les minutes,
   * et que ce classement n'est écrit nulle part ici : `readCellState` le fait,
   * pour les deux vues.
   */
  brutes: CellEntry[]
  /** nature de chaque saisie agrégée ; celle de la journée en dérive */
  kinds: TimeEntryKind[]
  /** vrai dès qu'une des saisies agrégées porte un créneau */
  hasSlots: boolean
}

function cellKey(lineId: string, date: string): string {
  return `${lineId}|${date}`
}

function slotKey(lineId: string, date: string, slotId: string): string {
  return `${lineId}|${date}|${slotId}`
}

type EtatJour = 'ouvre' | 'weekend' | 'ferie'

function etatJour(d: MonthDay): EtatJour {
  if (d.isHoliday) return 'ferie'
  return d.isWorking ? 'ouvre' : 'weekend'
}

// Fond ET motif — mais le motif ne sert plus qu'au férié. Le dithering du
// week-end était le signal d'ancienneté le plus fort du dessin, et il couvrait
// huit jours par mois. Le contrat non chromatique tient sans lui : l'écart de
// clarté entre `surface`, `off` et `off-strong` (100 / 91,2 / 85,4 en L*)
// porte l'information, et `MIN_LIGHTNESS_GAP` le vérifie déjà — le nom
// accessible du jour la porte pour qui ne voit ni l'un ni l'autre.
//
// Le férié garde le sien : dix jours par an, une information plus forte, et un
// marqueur si rare ne fatigue personne.
const FOND_JOUR: Record<EtatJour, string> = {
  ouvre: 'bg-surface',
  weekend: 'bg-off',
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
 * La forme d'une cellule — **la même règle que le calendrier**, prise au même
 * endroit : `readCellState` classe la journée, `formeDeLaCase` la dessine. Rien
 * n'est décidé ici, et surtout pas une seconde fois.
 *
 * La quantité se lit ainsi à la forme — aplat plein pour une journée, demi
 * taillé en diagonale pour une demi-journée, hauteur proportionnelle pour une
 * durée libre —, le chiffre restant par-dessus et jamais à sa place.
 */
function formeDeLaCellule(
  cell: Cell | undefined,
  line: LineForGrid,
  slots: readonly Slot[],
): Forme {
  if (cell === undefined) return { kind: 'AUCUNE' }
  const etat = readCellState(cell.brutes, { minutesParJour: line.minutesParJour, slots })
  // Les saisies partent une à une : chacune porte le facteur figé à son
  // écriture, et `formeDeLaCase` les convertit à facteur constant. Sommer
  // d'abord donnerait une hauteur d'aplat fausse.
  return formeDeLaCase(etat, cell.saisies, slots)
}

/**
 * L'encre du champ de saisie — une seule, jamais deux superposées.
 *
 * C'est la contrainte que le calendrier n'a pas : ces cellules sont des champs
 * modifiables, et l'aplat passe **derrière** le texte qu'on y tape. Dès qu'un
 * aplat porte la cellule, l'encre est `ink` : c'est le seul couple déclaré sur
 * les fonds de la palette catégorielle (`TEXT_PAIRS`, `core/theme/tokens.ts`).
 * `muted` — que le prévisionnel posait — et `warning-ink` — que la journée par
 * créneaux pose — tombent sous 4,5:1 sur les teintes les plus claires de cette
 * palette. Le prévisionnel et les créneaux ne perdent rien : le contour
 * tireté, l'italique et le liseré se lisent en vision monochrome, ce qu'une
 * nuance d'encre n'a jamais fait.
 */
function encreCellule(remplie: boolean, previsionnel: boolean, parCreneaux: boolean): string {
  if (remplie) return 'text-ink'
  if (parCreneaux) return 'text-warning-ink'
  return previsionnel ? 'text-muted' : 'text-ink'
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
      brutes: [...(prev?.brutes ?? []), e],
      // De même pour les natures : `kindDeLaJournee` tranche, et elle tranche
      // pour les deux vues à la fois.
      kinds: [...(prev?.kinds ?? []), e.kind],
      hasSlots: (prev?.hasSlots ?? false) || e.slotId !== '',
    })
  }

  return cells
}

/**
 * Saisies indexées sur leur clé réelle : (ligne, jour, créneau).
 *
 * Aucune agrégation ici — c'est tout l'intérêt : la clé d'unicité en base est
 * `(lineId, userId, date, slotId)`, et une cellule placée sur un créneau vise
 * cette saisie précise, jamais le total du jour.
 */
function buildSlotCells(entries: MonthEntry[]): Map<string, Cell> {
  const cells = new Map<string, Cell>()
  for (const e of entries) {
    cells.set(slotKey(e.lineId, e.date, e.slotId), {
      lineId: e.lineId,
      saisies: [{ minutes: e.minutes, minutesParJour: e.minutesParJour }],
      brutes: [e],
      kinds: [e.kind],
      hasSlots: e.slotId !== '',
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
  slots = AUCUN_CRENEAU,
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
  /**
   * créneaux configurés ; vide = saisie à la journée uniquement.
   *
   * Ce sont les créneaux **réglés en administration**, pas ceux qu'une ligne
   * autorise : un créneau hors des créneaux prévus reste choisissable, et fait
   * l'objet d'un signalement au retour du serveur — jamais d'un refus.
   */
  slots?: Slot[]
  /** renvoie `true` quand la valeur a bien été enregistrée */
  onSave: (lineId: string, date: string, raw: string, slotId: string) => Promise<boolean>
}) {
  const occupes = useMemo(() => new Set(busyDates), [busyDates])
  const cells = useMemo(() => buildCells(entries), [entries])
  const slotCells = useMemo(() => buildSlotCells(entries), [entries])

  // Créneau courant par ligne. Vide = journée, et c'est le défaut : le geste
  // principal n'est pas modifié par ce lot.
  const [slotByLine, setSlotByLine] = useState<ReadonlyMap<string, string>>(new Map())
  const slotDe = useCallback((lineId: string) => slotByLine.get(lineId) ?? '', [slotByLine])

  /**
   * La saisie qu'une cellule montre et vise : la journée agrégée tant qu'aucun
   * créneau n'est choisi, celle du créneau sinon.
   */
  const celluleAffichee = useCallback(
    (lineId: string, date: string): Cell | undefined => {
      const slot = slotByLine.get(lineId) ?? ''
      return slot === ''
        ? cells.get(cellKey(lineId, date))
        : slotCells.get(slotKey(lineId, date, slot))
    },
    [cells, slotCells, slotByLine],
  )

  // Valeurs telles que le serveur les connaît : ce sont elles qu'on restaure
  // quand un enregistrement est refusé.
  const serverValues = useMemo(() => {
    const values = new Map<string, string>()
    for (const line of lines) {
      for (const d of days) {
        const cell = celluleAffichee(line.id, d.date)
        if (cell === undefined) continue
        values.set(cellKey(line.id, d.date), quantiteAffichee(cell, line))
      }
    }
    return values
  }, [celluleAffichee, lines, days])

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
      const slot = slotByLine.get(lineId) ?? ''

      // En vue journée, réécrire une cellule qui agrège des créneaux créerait
      // une saisie supplémentaire à créneau vide, qui doublerait le total du
      // jour. Sur un créneau choisi, la cellule vise cette saisie précise : le
      // garde-fou n'a plus lieu d'être, et le maintenir rendrait la saisie par
      // créneau silencieusement inopérante là où elle sert le plus.
      if (slot === '' && cells.get(key)?.hasSlots === true) {
        setCell(key, serverValues.get(key) ?? '')
        return
      }

      setCell(key, raw)
      const saved = await onSave(lineId, date, raw, slot)
      if (!saved) setCell(key, serverValues.get(key) ?? '')
    },
    [cells, onSave, serverValues, setCell, slotByLine],
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
                <span className="mr-2">{l.label}</span>
                {/* Le sélecteur n'apparaît que si l'administration a réglé des
                    créneaux : sans créneau configuré, il n'offrirait que
                    « Journée » et n'annoncerait qu'une possibilité inexistante. */}
                {slots.length > 0 && (
                  <select
                    aria-label={`Créneau — ${l.label}`}
                    value={slotDe(l.id)}
                    onChange={(ev) =>
                      setSlotByLine((prev) => new Map(prev).set(l.id, ev.target.value))
                    }
                    className="touch-target rounded-md border border-rule bg-surface px-1 text-xs text-ink"
                  >
                    <option value="">Journée</option>
                    {slots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                )}
              </th>
              {days.map((d) => {
                const key = cellKey(l.id, d.date)
                const cell = celluleAffichee(l.id, d.date)
                // Seulement en vue journée : sur un créneau choisi, la cellule
                // est modifiable, c'est tout l'objet de ce lot.
                const parCreneaux = slotDe(l.id) === '' && cells.get(key)?.hasSlots === true
                const forme = formeDeLaCellule(cell, l, slots)
                const previsionnel = etatSaisie(cell) === 'previsionnel'
                // Une seule encre pour la cellule, et le champ la reprend :
                // c'est elle que `CoinEclate` prend par `currentColor`, et deux
                // encres divergentes feraient peindre le tracé d'une couleur
                // que rien ne mesure.
                const encre = encreCellule(forme.kind !== 'AUCUNE', previsionnel, parCreneaux)
                return (
                  <td
                    key={d.date}
                    data-jour={etatJour(d)}
                    onMouseDown={() => drag.handlers.onMouseDown(l.id, d.date)}
                    onMouseEnter={() => drag.handlers.onMouseEnter(l.id, d.date)}
                    onMouseUp={drag.handlers.onMouseUp}
                    // `relative` : l'aplat et le coin d'éclatement sont posés en
                    // absolu dans la cellule, et n'ajoutent donc aucune largeur
                    // — le budget des sept colonnes à 375 points n'en bouge pas.
                    //
                    // L'encre est portée ici et non seulement par le champ : la
                    // cellule est la case, et le tracé d'éclatement s'y peint en
                    // `currentColor`.
                    className={`relative ${FOND_JOUR[etatJour(d)]} ${encre} ${
                      drag.isSelected(l.id, d.date) ? 'ring-2 ring-inset ring-focus' : ''
                    }`}
                  >
                    {/* La même règle que le calendrier, et prise au même
                        endroit : le passé est froid, le futur est chaud. Un
                        jour prévisionnel prend `PREVU_COLOR` au lieu de la
                        teinte de sa prestation — sans quoi basculer entre les
                        deux vues du même écran montrerait deux apparences du
                        même fait. */}
                    <Aplat
                      cle={`${l.id}-${d.date}`}
                      forme={forme}
                      couleur={previsionnel ? PREVU_COLOR : colorForLine(l.id)}
                    />

                    {/* Après l'aplat, jamais avant : sans z-index, c'est
                        l'ordre du document qui décide, et le coin doit se poser
                        par-dessus la teinte qu'il traverse. Le liseré du champ
                        reste, comme renfort là où il se voit — mais il ne porte
                        plus seul l'avertissement, ce qu'une teinte à 1,63 de
                        L* du prévisionnel ne pouvait pas faire. */}
                    {parCreneaux && <CoinEclate cle={`${l.id}-${d.date}`} />}

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
                      //
                      // `relative` : le champ passe **au-dessus** de l'aplat,
                      // qui est le seul nœud positionné en absolu de la
                      // cellule. Sans cela, l'aplat recouvrirait le chiffre.
                      // Le contour tireté remplace la hachure, comme au
                      // calendrier : deux aplats opaques ne se distinguent pas
                      // en vision monochrome, et le tireté porte l'état sans
                      // la teinte. Il se pose sur le champ et non sur la
                      // cellule — le champ la recouvre exactement, et la
                      // bordure reste alors *dans* les 44 points (`box-sizing:
                      // border-box`), sans rien coûter au budget des colonnes.
                      className={`touch-target relative w-11 bg-transparent text-center text-xs ${encre} ${
                        previsionnel ? `${SEGMENT_PREVU_BORDURE} italic` : 'border-0'
                      } ${
                        parCreneaux ? 'ring-1 ring-inset ring-warning-edge' : ''
                      }`}
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
