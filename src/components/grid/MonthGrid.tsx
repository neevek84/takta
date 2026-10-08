'use client'

import { Fragment, useCallback, useMemo, useRef, useState } from 'react'
import { readCellState } from '@/core/saisie/cell-state'
import type { CellEntry } from '@/core/saisie/cell-state'
import { colorForLine, PREVU_COLOR } from '@/core/saisie/colors'
import { formeDeLaCase } from '@/core/saisie/forme'
import type { Forme } from '@/core/saisie/forme'
import { kindDeLaJournee } from '@/core/saisie/kind'
import { OCCUPATION_TITRE } from '@/core/saisie/occupation'
import { centiemesParFacteur, formatJours, formatQuantity } from '@/core/time/units'
import type { MinutesAuFacteur } from '@/core/time/units'
import { grouperParMois } from '@/core/month/build'
import type { MonthDay } from '@/core/month/build'
import { cleVerrou, moisDe } from '@/core/saisie/verrou'
import type { Slot } from '@/core/time/slots'
import type { CapacityMode, TimeEntryKind } from '@/core/types'
import type { LineForGrid } from '@/services/missions'
import type { LineEngagementTotals, MonthEntry } from '@/services/time-entries'
import { Aplat } from '@/components/ui/Aplat'
import { monthLabel } from '@/components/MonthNav'
// Le même tracé que le calendrier, pris au même endroit : le liseré
// `warning-edge` portait seul l'avertissement d'éclatement, et il ne s'écarte
// que de 1,63 en L* de `prevu` en Encre clair — le préréglage par défaut — pour
// un plancher de 4. Le coin, lui, est peint de l'encre de la cellule.
import { CoinAgrege } from '@/components/ui/CoinAgrege'
// `SEGMENT_PREVU_BORDURE` et non un tireté réécrit ici : la légende, les
// bandeaux d'engagement et cette cellule doivent porter **les mêmes classes**,
// sinon l'un des trois dérive sans que rien ne le dise.
import { SEGMENT_PREVU_BORDURE } from '@/components/ui/SegmentLegend'
import { BlocEngagement, FOND_JOUR, TITRE_JOUR } from './BlocEngagement'
import { TotalsRow } from './TotalsRow'
import { useDragSelect } from './useDragSelect'

/**
 * Constante de module et non littéral dans la déstructuration : un `[]` écrit
 * là créerait un tableau neuf à chaque rendu et invaliderait le `useMemo` qui
 * en dérive l'ensemble des jours occupés.
 */
const AUCUNE_OCCUPATION: string[] = []

/** Même raison que `AUCUNE_OCCUPATION` : un littéral neuf à chaque rendu. */
const AUCUN_CRENEAU: Slot[] = []

/** Même raison encore. */
const AUCUN_VERROU: readonly string[] = []

// « plusieurs » était faux : la condition se déclenche dès **un** créneau
// nommé. Un texte qui décrit un autre cas que celui qui l'a déclenché envoie
// chercher une saisie qui n'existe pas.
const CELLULE_CRENEAUX =
  'Journée saisie par créneaux : la cellule totalise les créneaux du jour et se modifie créneau par créneau.'

// Un champ en lecture seule ressemble à s'y méprendre à un champ modifiable :
// le verrou se dit dans l'infobulle de la cellule, et en toutes lettres à côté
// de la prestation ou de son total du mois — jamais par une teinte seule.
const CELLULE_FERMEE =
  'CRA envoyé ou validé : ce mois est en lecture seule pour cette prestation.'
const MENTION_FERMEE = 'CRA fermé'

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
function quantiteAffichee(saisies: readonly MinutesAuFacteur[], line: LineForGrid): string {
  if (line.displayUnit === 'HEURE') {
    return formatQuantity(minutesTotales(saisies), 'HEURE', line.minutesParJour)
  }
  return formatJours(centiemesParFacteur(saisies))
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
  slots: readonly Slot[],
): Forme {
  if (cell === undefined) return { kind: 'AUCUNE' }
  // Le facteur de la prestation n'entre pas dans la lecture : chaque saisie
  // porte celui qui a été figé à son écriture. C'est la condition pour que la
  // cellule et la case du calendrier classent la journée pareil, y compris sur
  // un CRA validé dont le réglage a bougé depuis.
  const etat = readCellState(cell.brutes, { slots })
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
      // `minutes > 0`, comme `readCellState` : une saisie à zéro n'agrège rien.
      // Sans ce filtre, la cellule se verrouillait sur un jour que le
      // calendrier montrait vide — le même fait lu de deux façons.
      hasSlots: (prev?.hasSlots ?? false) || (e.slotId !== '' && e.minutes > 0),
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
      hasSlots: e.slotId !== '' && e.minutes > 0,
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
  verrous = AUCUN_VERROU,
  onSave,
}: {
  /**
   * les jours affichés, dans l'ordre : un mois, ou plusieurs bout à bout.
   *
   * Sur plusieurs mois — le tableau 3 mois —, la grille nomme chaque mois au
   * dessus de ses jours, trace une frontière à son premier jour et le clôt par
   * une colonne de total. Les cellules, elles, ne changent pas : ce sont les
   * mêmes, rendues par le même code.
   */
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
  /**
   * prestations fermées à la saisie, une clé `cleVerrou(ligne, mois)` chacune.
   *
   * Le verrou porte sur un mois, jamais sur la vue : sur trois mois, un mois
   * validé reste en lecture seule pendant que ses voisins se saisissent. Le
   * service le revérifie à chaque écriture ; ceci n'évite que l'aller-retour
   * d'un refus annoncé d'avance.
   */
  verrous?: readonly string[]
  /** renvoie `true` quand la valeur a bien été enregistrée */
  onSave: (lineId: string, date: string, raw: string, slotId: string) => Promise<boolean>
}) {
  const occupes = useMemo(() => new Set(busyDates), [busyDates])
  const cells = useMemo(() => buildCells(entries), [entries])
  const slotCells = useMemo(() => buildSlotCells(entries), [entries])
  const fermes = useMemo(() => new Set(verrous), [verrous])
  const estFerme = useCallback(
    (lineId: string, date: string) => fermes.has(cleVerrou(lineId, moisDe(date))),
    [fermes],
  )

  // Les mois affichés, chacun avec ses jours. Un seul bloc : la grille d'un
  // mois, telle qu'elle a toujours été — ni en-tête de mois, ni total mensuel.
  const blocs = useMemo(() => grouperParMois(days), [days])
  const plusieursMois = blocs.length > 1

  /**
   * Toutes les saisies d'une prestation sur un mois, créneaux compris.
   *
   * Gardées une à une, comme dans les cellules : le total se convertit saisie
   * par saisie sous le facteur figé à son écriture. C'est ce qui garde ses
   * chiffres à un mois validé quand le réglage de la prestation bouge après.
   * Indexées par `cleVerrou` : c'est la même clé (prestation, mois).
   */
  const saisiesDuMois = useMemo(() => {
    const parCle = new Map<string, MinutesAuFacteur[]>()
    for (const e of entries) {
      const cle = cleVerrou(e.lineId, moisDe(e.date))
      parCle.set(cle, [...(parCle.get(cle) ?? []), { minutes: e.minutes, minutesParJour: e.minutesParJour }])
    }
    return parCle
  }, [entries])

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
        values.set(cellKey(line.id, d.date), quantiteAffichee(cell.saisies, line))
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

      // Un mois fermé n'écrit rien — y compris par un glissement qui le
      // traverse depuis un mois ouvert : la cellule reprend sa valeur.
      if (estFerme(lineId, date)) {
        setCell(key, serverValues.get(key) ?? '')
        return
      }

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
    [cells, estFerme, onSave, serverValues, setCell, slotByLine],
  )

  const drag = useDragSelect((sel, raw) => {
    for (const date of sel.dates) void commit(sel.lineId, date, raw)
  })

  return (
    <div className="overflow-x-auto">
      <BlocEngagement
        lines={lines}
        engagementTotals={engagementTotals}
        avecOccupation={occupes.size > 0}
      />

      <table className="border-collapse text-sm">
        <thead>
          {/* Sur plusieurs mois, chaque mois se nomme au-dessus de ses jours :
              les numéros de jour seuls se répètent d'un mois à l'autre, et
              rien ne dirait où avril finit et où mai commence. */}
          {plusieursMois && (
            <tr>
              <td className="sticky left-0 z-10 bg-surface" />
              {blocs.map((bloc) => (
                <th
                  key={bloc.mois}
                  scope="colgroup"
                  colSpan={bloc.days.length + 1}
                  data-testid={`entete-mois-${bloc.mois}`}
                  className="border-l-2 border-l-ink px-2 py-1 text-left text-sm font-medium text-ink"
                >
                  {monthLabel(bloc.mois)}
                </th>
              ))}
            </tr>
          )}
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left">
              Ligne
            </th>
            {blocs.map((bloc) => (
              <Fragment key={bloc.mois}>
                {bloc.days.map((d, i) => {
                  const occupe = occupes.has(d.date)
                  // La frontière d'un mois : un filet épais, une différence de
                  // forme et non de teinte — seulement quand il y a plusieurs mois.
                  const debut = plusieursMois && i === 0
                  return (
                    <th
                      key={d.date}
                      scope="col"
                      data-testid={`day-header-${d.date}`}
                      data-jour={etatJour(d)}
                      data-busy={occupe ? 'true' : undefined}
                      data-debut-mois={debut ? 'true' : undefined}
                      title={titreEntete(etatJour(d), occupe)}
                      // Un liseré et non un fond : le fond porte déjà l'état du
                      // jour, et un aplat de plus l'effacerait. Le liseré est une
                      // différence de forme, lisible sans distinguer les teintes.
                      className={`w-11 px-1 py-1 text-center text-xs font-normal text-ink ${
                        FOND_JOUR[etatJour(d)]
                      } ${occupe ? 'border-b-2 border-b-accent-dark' : ''} ${
                        debut ? 'border-l-2 border-l-ink' : ''
                      }`}
                    >
                      {Number(d.date.slice(8))}
                      {/* Ni le liseré ni le `title` n'existent pour un lecteur
                          d'écran, et l'occupation ne se déduit pas de la date
                          comme le week-end : elle se dit. */}
                      {occupe && <span className="sr-only"> — {OCCUPATION_TITRE}</span>}
                    </th>
                  )
                })}
                {plusieursMois && (
                  <th
                    scope="col"
                    className="border-l border-rule px-1 py-1 text-center text-xs font-medium text-ink"
                  >
                    Total
                    <span className="sr-only"> {monthLabel(bloc.mois)}</span>
                  </th>
                )}
              </Fragment>
            ))}
          </tr>
        </thead>

        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-rule">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-normal">
                <span className="mr-2">{l.label}</span>
                {/* Sur un seul mois, aucune colonne de total ne porte le
                    verrou : il se dit à côté du libellé de la prestation. */}
                {!plusieursMois && fermes.has(cleVerrou(l.id, blocs[0]?.mois ?? '')) && (
                  <span className="mr-2 text-xs text-muted">· {MENTION_FERMEE}</span>
                )}
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
              {blocs.map((bloc) => {
                const totalDuMois = saisiesDuMois.get(cleVerrou(l.id, bloc.mois))
                const moisFerme = fermes.has(cleVerrou(l.id, bloc.mois))
                return (
                  <Fragment key={bloc.mois}>
                    {bloc.days.map((d, i) => {
                        const key = cellKey(l.id, d.date)
                        const cell = celluleAffichee(l.id, d.date)
                        // Seulement en vue journée : sur un créneau choisi, la cellule
                        // est modifiable, c'est tout l'objet de ce lot.
                        const parCreneaux = slotDe(l.id) === '' && cells.get(key)?.hasSlots === true
                        const ferme = estFerme(l.id, d.date)
                        const forme = formeDeLaCellule(cell, slots)
                        const previsionnel = etatSaisie(cell) === 'previsionnel'
                        // Une seule encre pour la cellule, et le champ la reprend :
                        // c'est elle que `CoinAgrege` prend par `currentColor`, et deux
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
                            } ${plusieursMois && i === 0 ? 'border-l-2 border-l-ink' : ''}`}
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
                            {parCreneaux && <CoinAgrege cle={`${l.id}-${d.date}`} />}

                            <input
                              aria-label={`${l.label} ${d.date}`}
                              data-saisie={etatSaisie(cell)}
                              value={values.get(key) ?? ''}
                              data-verrou={ferme ? 'true' : undefined}
                              readOnly={parCreneaux || ferme}
                              title={ferme ? CELLULE_FERMEE : parCreneaux ? CELLULE_CRENEAUX : undefined}
                              onChange={(ev) => {
                                if (!ferme) setCell(key, ev.target.value)
                              }}
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
                    {/* Le total de la prestation sur le mois, dans son unité,
                        et le verrou dit en toutes lettres : c'est la seule
                        colonne qui parle du mois plutôt que d'un jour. */}
                    {plusieursMois && (
                      <td
                        data-testid={`total-ligne-${l.id}-${bloc.mois}`}
                        className="border-l border-rule px-1 py-1 text-center text-xs text-ink"
                      >
                        {totalDuMois === undefined ? '' : quantiteAffichee(totalDuMois, l)}
                        {moisFerme && (
                          <span className="block text-xs text-muted">{MENTION_FERMEE}</span>
                        )}
                      </td>
                    )}
                  </Fragment>
                )
              })}
            </tr>
          ))}

          <TotalsRow
            parMois={plusieursMois}
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
