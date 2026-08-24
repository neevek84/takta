'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildWeeks } from '@/core/month/weeks'
import { buildCellStates } from '@/core/saisie/cell-state'
import { colorForLine, couleurDAplat, PREVU_COLOR } from '@/core/saisie/colors'
import type { LineColor } from '@/core/saisie/colors'
import { formeDeLaCase } from '@/core/saisie/forme'
import { positionDansLaPlage } from '@/core/saisie/plage'
import type { Position } from '@/core/saisie/plage'
import { kindDeLaJournee } from '@/core/saisie/kind'
import { OCCUPATION_TITRE } from '@/core/saisie/occupation'
import { libelleDemiJournee, libelleDemiJourneeDetaille } from '@/core/saisie/slot-labels'
import { cycleSlotIds, nextCellState } from '@/core/saisie/cycle'
import type { CellState } from '@/core/saisie/cycle'
import { centiemesParFacteur, formatJours, formatQuantity } from '@/core/time/units'
import type { MinutesAuFacteur } from '@/core/time/units'
import type { MonthDay } from '@/core/month/build'
import type { Slot } from '@/core/time/slots'
import type { TimeEntryKind } from '@/core/types'
import { Aplat } from '@/components/ui/Aplat'
// Le tracé de la journée éclatée, partagé avec la vue tableau : c'est le même
// fait sur le même écran, et une bascule de vue ne doit pas en montrer deux
// dessins. Même raison qu'`Aplat`, voisin de ligne.
import { CoinEclate } from '@/components/ui/CoinEclate'
import { Button } from '@/components/ui/Button'
import { IconeOccupation, IconePrevisionnel } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useDragSelect } from '@/components/grid/useDragSelect'
import type { LineForGrid } from '@/services/missions'
import type { MonthEntry } from '@/services/time-entries'
import { useLongPress } from './useLongPress'

const VIDE: CellState = { kind: 'VIDE' }

const AUCUNE_SAISIE: MinutesAuFacteur[] = []

/**
 * Constante de module et non littéral dans la déstructuration : un `[]` écrit
 * là créerait un tableau neuf à chaque rendu et invaliderait le `useMemo` qui
 * en dérive l'ensemble des jours occupés.
 */
const AUCUNE_OCCUPATION: string[] = []

const EN_TETES = [
  { dayOfWeek: 1, court: 'L', long: 'Lun' },
  { dayOfWeek: 2, court: 'M', long: 'Mar' },
  { dayOfWeek: 3, court: 'M', long: 'Mer' },
  { dayOfWeek: 4, court: 'J', long: 'Jeu' },
  { dayOfWeek: 5, court: 'V', long: 'Ven' },
  { dayOfWeek: 6, court: 'S', long: 'Sam' },
  { dayOfWeek: 7, court: 'D', long: 'Dim' },
]

/**
 * Ce que Maj+flèche déplace, en jours.
 *
 * Les verticales valent une semaine parce que c'est ce que la grille montre :
 * sept colonnes, une ligne par semaine. Sans elles, une plage de plusieurs
 * semaines demanderait autant de frappes qu'elle compte de jours.
 */
const PAS_DE_FLECHE: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
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

/**
 * Ce que la position dans une plage change au dessin de la case.
 *
 * Aucune marge, aucune gouttière touchée, aucune bordure retirée : la boîte
 * est **identique** dans les quatre cas. À 375 points, la colonne vaut 45,0
 * pour une cible de 44 — un seul point de marge —, et le test qui le mesure ne
 * compte que la gouttière `gap-*` : il ne verrait pas une marge ajoutée ici.
 *
 * Les filets intérieurs deviennent donc `transparent`, jamais `0` : une
 * bordure transparente occupe toujours sa largeur. Seule une case isolée
 * découpe son aplat — les autres le laissent déborder pour souder la plage.
 */
const PLAGE_CLASSES: Record<Position, string> = {
  SEULE: 'overflow-hidden rounded-sm',
  DEBUT: 'rounded-l-sm rounded-r-none border-r-transparent',
  MILIEU: 'rounded-none border-x-transparent',
  FIN: 'rounded-r-sm rounded-l-none border-l-transparent',
}

/**
 * Le débord de l'aplat, qui soude visuellement deux cases voisines.
 *
 * L'aplat est posé en absolu : un débord négatif couvre la gouttière et
 * n'ajoute **aucune largeur** à la case. Les bouts reprennent le rayon que la
 * case ne peut plus leur donner, puisqu'elle ne les découpe plus.
 */
const PLAGE_APLAT: Record<Position, string> = {
  SEULE: '',
  DEBUT: 'rounded-l-sm -mr-0.5',
  MILIEU: '-mx-0.5',
  FIN: 'rounded-r-sm -ml-0.5',
}

const TITRE_JOUR: Record<EtatJour, string | undefined> = {
  ouvre: undefined,
  weekend: 'Jour non ouvré',
  ferie: 'Jour férié',
}

function libelleSlot(slotId: string, slots: readonly Slot[]): string {
  return slots.find((s) => s.id === slotId)?.label ?? slotId
}

/**
 * L'horloge du prévisionnel et le losange de l'occupation.
 *
 * Les hachures que l'horloge remplace étaient illisibles — constaté à l'usage.
 * Le prévisionnel garde donc **exactement le même remplissage que le réalisé**,
 * et c'est ce tracé qui les sépare : il se voit en monochrome, ce que la règle
 * du projet exige, là où une teinte seule ne suffirait pas.
 *
 * Le losange, lui, était encore le caractère `◆` de la police système. Les deux
 * viennent désormais du même jeu de tracés, à la même taille et au même trait.
 */
function Horloge({ date }: { date?: string }) {
  return (
    <IconePrevisionnel
      testId={date === undefined ? undefined : `previsionnel-${date}`}
      className="shrink-0"
    />
  )
}

/**
 * Ce que la case affiche.
 *
 * L'unité est celle sous laquelle la prestation est vendue, jamais l'heure
 * par défaut : la même saisie s'affichait « 3h » ici et « 0,38 » dans le
 * tableau, pour la même donnée.
 *
 * En journées, chaque saisie se convertit sous le facteur **figé à son
 * écriture** — c'est le rôle de `centiemesParFacteur` —, jamais la somme des
 * minutes sous le facteur courant de la ligne : une journée écrite en deux
 * temps à 7 h puis à 8 h vaut 1,07 j, pas 1 j. C'est le chemin exact que
 * `MonthGrid` emprunte.
 *
 * Les deux crans du cycle, eux, n'ont pas de chiffre à convertir : « 1 » et
 * « ½ AM » *sont* le classement, et ce classement se fait déjà sous le facteur
 * figé (`readCellState`). C'est ce qui les tient d'accord avec le tableau :
 * une saisie de 480 minutes figée à 420 n'est plus une journée entière, elle
 * tombe en valeur libre et les deux vues affichent « 1,14 ». Ce commentaire a
 * affirmé le contraire — que ces deux branches passaient par
 * `centiemesParFacteur` — pendant que le calendrier affichait « 1 ».
 */
function contenu(
  etat: CellState,
  slots: readonly Slot[],
  line: LineForGrid,
  saisies: readonly MinutesAuFacteur[],
): string {
  switch (etat.kind) {
    case 'VIDE':
      return ''
    case 'JOURNEE':
      return '1'
    case 'DEMI':
      // « ½ M » et « ½ A » se confondaient dans une case de 44 points, et
      // « M » pouvait dire « Matin » comme « Midi ». AM et PM sont universels.
      return libelleDemiJournee(etat.slotId, slots)
    case 'LIBRE':
      return line.displayUnit === 'HEURE'
        ? formatQuantity(etat.minutes, 'HEURE', line.minutesParJour)
        : formatJours(centiemesParFacteur(saisies))
  }
}

function description(etat: CellState, slots: readonly Slot[]): string {
  switch (etat.kind) {
    case 'VIDE':
      return 'Aucune saisie'
    case 'JOURNEE':
      return 'Journée entière'
    case 'DEMI':
      // L'infobulle a la place de dire les deux : l'abréviation universelle
      // que le porteur veut voir partout, et le libellé réglé en administration.
      return `Demi-journée ${libelleDemiJourneeDetaille(etat.slotId, slots)}`
    case 'LIBRE':
      return etat.eclatee
        ? 'Journée saisie en plusieurs créneaux'
        : `Durée libre${etat.slotId === '' ? '' : ` — ${libelleSlot(etat.slotId, slots)}`}`
  }
}

/**
 * Le geste de sélection en cours.
 *
 * `ANCRE` est un glissement parti d'une case ; `EXTENSION` est le jour touché
 * pour agrandir une sélection déjà posée. Les distinguer est nécessaire :
 * relâcher un glissement qui n'a jamais quitté sa case efface la sélection —
 * un simple clic ne laisse rien derrière lui —, alors que relâcher une
 * extension doit la conserver.
 */
type Geste = { type: 'ANCRE'; date: string } | { type: 'EXTENSION' }

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
  densite = 'NORMALE',
  busyDates = AUCUNE_OCCUPATION,
  aujourdhui,
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
  /**
   * Le calibre de la grille.
   *
   * `COMPACTE` sert la vue 3 mois : trois grilles dans l'emprise d'une seule
   * ramènent la case de ~145 à ~55 points. Elle perd alors ce qui ne survit
   * pas à la réduction — les libellés d'heures et de créneau — et garde ce qui
   * porte l'information : l'aplat, le numéro du jour, les marqueurs.
   *
   * **Une prop et non un second composant.** Deux dessins de la même grille
   * divergeraient au premier correctif, et une bascule de vue montrerait alors
   * deux fois le même fait de deux façons — c'est ce que la note d'`Aplat` dit
   * déjà du tableau et du calendrier.
   */
  densite?: 'NORMALE' | 'COMPACTE'
  /**
   * jours du mois porteurs d'une occupation dans l'agenda externe.
   *
   * Facultatif, et vide par défaut : l'agenda injoignable est le cas nominal,
   * pas une anomalie. Une case marquée reste cliquable — le marquage informe,
   * il n'interdit rien.
   */
  busyDates?: string[]
  /**
   * le jour courant, 'YYYY-MM-DD'.
   *
   * Transmis par la page plutôt que lu à l'horloge du navigateur : le rendu
   * serveur et le rendu client doivent tomber d'accord, et un mois qui ne
   * contient pas ce jour n'en marque simplement aucun.
   */
  aujourdhui?: string
  /** renvoie `true` quand l'état a bien été enregistré */
  onApply: (date: string, state: CellState) => Promise<boolean>
  onRange: (dates: string[], state: CellState) => Promise<void>
  onFormulaire: (date: string, etat: CellState) => void
}) {
  const semaines = useMemo(() => buildWeeks(days), [days])
  const occupes = useMemo(() => new Set(busyDates), [busyDates])

  // Le contexte de lecture ne porte que les créneaux : le facteur de
  // conversion vit sur chaque saisie, figé à son écriture. Le lui donner ici
  // suffisait à casser le gel — une journée écrite à 420 minutes cessait
  // d'être une journée dès que la prestation passait à 480, sur un CRA validé
  // que `recalibrateOpenMonths` laisse pourtant intact.
  const ctx = useMemo(() => ({ slots }), [slots])
  const options = useMemo(
    () => ({ demiSlotIds: cycleSlotIds(slots, line.allowedSlotIds), displayUnit: line.displayUnit }),
    [slots, line.allowedSlotIds, line.displayUnit],
  )

  const serveur = useMemo(() => buildCellStates(entries, line.id, ctx), [entries, line.id, ctx])

  // Le `kind` ne rentre pas dans `CellState` : il dit comment la case
  // s'affiche, jamais ce que le clic suivant écrit.
  //
  // La nature d'une journée se lit par `kindDeLaJournee`, la même fonction que
  // le tableau : une règle écrite deux fois finit par diverger, et les deux
  // vues afficheraient alors deux natures pour le même jour — ce qui était
  // précisément le défaut I3.
  const previsionnelles = useMemo(() => {
    const kindsParDate = new Map<string, TimeEntryKind[]>()
    for (const e of entries) {
      if (e.lineId !== line.id) continue
      const kinds = kindsParDate.get(e.date)
      if (kinds === undefined) kindsParDate.set(e.date, [e.kind])
      else kinds.push(e.kind)
    }

    const dates = new Set<string>()
    for (const [date, kinds] of kindsParDate) {
      if (kindDeLaJournee(kinds) === 'PREVISIONNEL') dates.add(date)
    }
    return dates
  }, [entries, line.id])

  // Les saisies du jour, une à une, chacune avec le facteur figé à son
  // écriture : les sommer avant de convertir écraserait cette distinction.
  const saisiesParDate = useMemo(() => {
    const parDate = new Map<string, MinutesAuFacteur[]>()
    for (const e of entries) {
      if (e.lineId !== line.id) continue
      const valeur = { minutes: e.minutes, minutesParJour: e.minutesParJour }
      const bucket = parDate.get(e.date)
      if (bucket === undefined) parDate.set(e.date, [valeur])
      else bucket.push(valeur)
    }
    return parDate
  }, [entries, line.id])

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

  /**
   * Les saisies à afficher pour une date. Une case affichée de façon optimiste
   * n'a pas encore de saisie au serveur : elle vaut ce que le geste vient
   * d'écrire, sous le facteur courant de la prestation.
   */
  const saisiesDe = useCallback(
    (date: string): MinutesAuFacteur[] => {
      const attendu = optimiste.get(date)
      if (attendu === undefined) return saisiesParDate.get(date) ?? AUCUNE_SAISIE
      return attendu.kind === 'LIBRE'
        ? [{ minutes: attendu.minutes, minutesParJour: line.minutesParJour }]
        : AUCUNE_SAISIE
    },
    [optimiste, saisiesParDate, line.minutesParJour],
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

  const conteneur = useRef<HTMLDivElement>(null)
  const geste = useRef<Geste | null>(null)
  /** Vrai quand le geste en cours a dépassé sa case : le clic qui suit est à lui. */
  const aGlisse = useRef(false)

  const consommerGlissement = useCallback((): boolean => {
    const oui = aGlisse.current
    aGlisse.current = false
    return oui
  }, [])

  /**
   * Le pointeur s'appuie sur une case — doigt, stylet ou souris.
   *
   * En événements *pointer* et non *mouse* : `mouseenter` n'est pas émis
   * pendant qu'un doigt glisse, et la barre de sélection n'apparaissait donc
   * jamais sur un téléphone — où la vue tableau est masquée, donc où le
   * calendrier est la seule surface de saisie.
   */
  const debuterGeste = useCallback(
    (date: string) => {
      aGlisse.current = false
      // Une sélection déjà posée s'étend au jour touché : c'est le seul
      // équivalent de Maj+clic dont un doigt dispose, et la seule façon
      // d'atteindre une plage qui déborde de la semaine sans que le
      // navigateur ne reprenne le geste pour faire défiler la page.
      if (drag.selection !== null && drag.selection.dates.length > 1) {
        geste.current = { type: 'EXTENSION' }
        aGlisse.current = true
        drag.extendTo(line.id, date, date)
        return
      }
      geste.current = { type: 'ANCRE', date }
      drag.handlers.onMouseDown(line.id, date)
    },
    [drag, line.id],
  )

  const survolerPendantGeste = useCallback(
    (date: string) => {
      const encours = geste.current
      if (encours === null || encours.type !== 'ANCRE') return
      if (date !== encours.date) aGlisse.current = true
      drag.handlers.onMouseEnter(line.id, date)
    },
    [drag, line.id],
  )

  const terminerGeste = useCallback(() => {
    const encours = geste.current
    geste.current = null
    if (encours === null) return
    drag.handlers.onMouseUp()
    // Un simple clic ne laisse rien derrière lui : sans cela, la case gardait
    // sa bague jusqu'au prochain appui, alors que rien n'était sélectionné.
    if (encours.type === 'ANCRE' && !aGlisse.current) drag.clear()
  }, [drag])

  /** Le navigateur reprend le geste — un défilement, le plus souvent. */
  const abandonnerGeste = useCallback(() => {
    const encours = geste.current
    geste.current = null
    aGlisse.current = false
    if (encours !== null && encours.type === 'ANCRE') drag.clear()
  }, [drag])

  /**
   * Le relâchement se lit sur la **fenêtre**, jamais sur la seule grille.
   *
   * Posé sur le conteneur, il manquait tous les relâchements qui se produisent
   * ailleurs — sous la dernière semaine, dans la marge, sur la barre de
   * sélection — et le geste restait armé : chaque case ensuite *survolée*,
   * sans aucun bouton enfoncé, rejoignait la sélection, puis « 1 jour »
   * écrivait une journée entière sur des jours que personne n'avait désignés.
   * Dans un compte-rendu d'activité, c'est de la donnée fabriquée.
   *
   * `terminerGeste` est sans effet quand aucun geste ne court : le relâchement
   * qui remonte depuis une case le traverse donc deux fois sans dommage.
   */
  useEffect(() => {
    const surRelachement = (): void => terminerGeste()
    const surAnnulation = (): void => abandonnerGeste()
    window.addEventListener('pointerup', surRelachement)
    window.addEventListener('pointercancel', surAnnulation)
    return () => {
      window.removeEventListener('pointerup', surRelachement)
      window.removeEventListener('pointercancel', surAnnulation)
    }
  }, [terminerGeste, abandonnerGeste])

  const rangParDate = useMemo(() => new Map(days.map((d, i) => [d.date, i])), [days])

  /**
   * Maj+flèche : l'équivalent clavier du glissement.
   *
   * Le déplacement se compte en rangs dans le mois plutôt qu'en dates : les
   * jours y sont consécutifs, une semaine vaut donc sept rangs, et rien ne
   * peut déborder du mois affiché.
   */
  const etendreAuClavier = useCallback(
    (depuis: string, pas: number) => {
      const rang = rangParDate.get(depuis)
      if (rang === undefined) return
      const cible = days[rang + pas]
      if (cible === undefined) return

      drag.extendTo(line.id, depuis, cible.date)
      conteneur.current?.querySelector<HTMLElement>(`[data-date="${cible.date}"]`)?.focus()
    },
    [days, rangParDate, drag, line.id],
  )

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

  // La teinte de la prestation saisie suit la portée affichée : en « Cette
  // prestation », une couleur catégorielle ne distinguerait rien et se lirait
  // pourtant comme une information. Les libellés des **autres** prestations
  // gardent `colorForLine` : ils ne sont rendus qu'en « Toutes les
  // prestations », où la teinte porte enfin une distinction.
  const couleur = couleurDAplat(line.id, toutLeMois)

  /**
   * Les clés de fusion, **dans l'ordre de la grille** et non du mois.
   *
   * `semaines.flat()` porte sept cases par ligne, cases hors mois comprises :
   * c'est ce qui permet à `positionDansLaPlage` de reconnaître une fin de
   * ligne par un simple `index / 7`. Les dériver de `days` serait faux dès
   * qu'un mois ne commence pas un lundi — c'est-à-dire presque toujours.
   *
   * `null` dès que la case ne fusionne pas : une plage ne réunit que des
   * journées entières de même nature, sur des jours ouvrés. Une demi-journée
   * n'est pas le même fait que le jour d'à côté — elle garde ses quatre
   * filets, son rayon et ses marges.
   */
  const clesDePlage = useMemo(
    () =>
      semaines.flat().map((jour) => {
        if (jour === null || etatJour(jour) !== 'ouvre') return null
        if (etatDe(jour.date).kind !== 'JOURNEE') return null
        return previsionnelles.has(jour.date) ? 'PREVU' : 'REALISE'
      }),
    [semaines, etatDe, previsionnelles],
  )

  return (
    <div>
      <p
        data-testid="legende-calendrier"
        className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
      >
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

        {/* Les formes de l'aplat. Une forme qu'on doit deviner ne se lit pas
            mieux qu'un chiffre : la légende la nomme, et avec les mots que
            l'infobulle et la barre de sélection emploient. */}
        <span className="inline-flex items-center gap-1">
          <Pastille couleur={couleur} />1 j
        </span>
        <span className="inline-flex items-center gap-1">
          <Pastille couleur={couleur} decoupe="clip-half-am" />½ AM
        </span>
        <span className="inline-flex items-center gap-1">
          <Pastille couleur={couleur} decoupe="clip-half-pm" />½ PM
        </span>
        {/* Le prévisionnel a désormais sa teinte : la légende la montre, sinon
            elle nommerait une chose sans la donner à voir. L'horloge reste. */}
        <span className="inline-flex items-center gap-1">
          <Pastille couleur={PREVU_COLOR} tirete />
          <Horloge />
          Prévisionnel
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            aria-hidden="true"
            className="inline-block h-4 w-4 rounded-sm border-2 border-ink bg-surface"
          />
          Aujourd’hui
        </span>
      </p>

      <div
        ref={conteneur}
        data-testid="grille-calendrier"
        // Gouttière d'un demi-pas et non d'un pas entier : sur un écran de
        // 375 points, sept cases à 44 points et six gouttières de 4 ne tiennent
        // pas dans les 327 points que la page laisse — la grille débordait,
        // ou les cases tombaient sous la cible tactile. Voir le test de budget.
        className="grid grid-cols-7 gap-0.5"
        // Ni ici ni sur les cases : le relâchement et l'annulation sont
        // écoutés sur la fenêtre (voir l'effet plus haut). Au doigt comme à la
        // souris, le pointeur est relâché là où il se trouve — et ce n'est pas
        // toujours la case d'où il est parti, ni même la grille.
      >
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
                saisies={saisiesDe(jour.date)}
                previsionnel={previsionnelles.has(jour.date)}
                occupe={occupes.has(jour.date)}
                aujourdhui={jour.date === aujourdhui}
                autres={autresParDate.get(jour.date) ?? []}
                selected={drag.isSelected(line.id, jour.date)}
                position={positionDansLaPlage(i * 7 + j, clesDePlage)}
                slots={slots}
                line={line}
                couleur={couleur}
                densite={densite}
                consommerGlissement={consommerGlissement}
                onClick={() => void cliquer(jour.date)}
                onFormulaire={() => onFormulaire(jour.date, etatDe(jour.date))}
                onGesteAbandon={abandonnerGeste}
                onGesteDebut={() => debuterGeste(jour.date)}
                onGesteSurvol={() => survolerPendantGeste(jour.date)}
                onEtendreClavier={(pas) => etendreAuClavier(jour.date, pas)}
                onAbandonner={drag.clear}
              />
            ),
          ),
        )}
      </div>

      {barreVisible && (
        <div
          data-testid="barre-selection"
          // Au clavier, la sélection ne se voit que par la bague : sans région
          // vivante, Maj+flèche resterait muette pour un lecteur d'écran.
          role="status"
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
              {libelleDemiJournee(slotId, slots)}
            </Button>
          ))}
          <Button type="button" onClick={() => void appliquerPlage({ kind: 'VIDE' })}>
            Vider ces jours
          </Button>
          <Button type="button" onClick={drag.clear}>
            Annuler la sélection
          </Button>
          {/* Le geste d'agrandissement ne se devine pas : il se dit. */}
          <span className="basis-full text-xs text-muted">
            Touchez un autre jour pour étendre la sélection, ou Maj et une flèche au clavier.
            Échap l’abandonne.
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * L'échantillon de la légende : une case en réduction, avec sa découpe.
 *
 * Le fond de la case est rendu, la découpe taille l'aplat par-dessus : c'est
 * la même superposition que dans la grille, sans quoi la légende montrerait un
 * triangle flottant plutôt que la moitié d'une case.
 */
function Pastille({
  couleur,
  decoupe,
  tirete = false,
}: {
  couleur: LineColor
  decoupe?: string
  /** le contour tireté du prévisionnel, comme sur la case */
  tirete?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative inline-block h-4 w-4 overflow-hidden rounded-sm border border-rule bg-surface',
        tirete && 'border-dashed',
      )}
    >
      <span className={cn('absolute inset-0', couleur.bg, decoupe)} />
    </span>
  )
}

function Case({
  jour,
  etat,
  saisies,
  previsionnel,
  occupe,
  aujourdhui,
  autres,
  selected,
  position,
  slots,
  line,
  couleur,
  densite,
  consommerGlissement,
  onClick,
  onFormulaire,
  onGesteAbandon,
  onGesteDebut,
  onGesteSurvol,
  onEtendreClavier,
  onAbandonner,
}: {
  jour: MonthDay
  etat: CellState
  /** saisies du jour, chacune sous le facteur figé à son écriture */
  saisies: readonly MinutesAuFacteur[]
  previsionnel: boolean
  /** l'agenda externe porte déjà quelque chose ce jour-là — informatif */
  occupe: boolean
  /** ce jour est le jour courant */
  aujourdhui: boolean
  /** autres prestations occupant ce jour, en lecture seule */
  autres: LineForGrid[]
  selected: boolean
  /** place du jour dans sa suite de jours contigus au même état */
  position: Position
  slots: Slot[]
  line: LineForGrid
  /** teinte de la prestation saisie, celle de l'aplat */
  couleur: LineColor
  /** voir la documentation de la prop du même nom sur `MonthCalendar` */
  densite: 'NORMALE' | 'COMPACTE'
  consommerGlissement: () => boolean
  onClick: () => void
  onFormulaire: () => void
  /** termine le geste de pointeur en cours et efface ce qu'il avait posé */
  onGesteAbandon: () => void
  onGesteDebut: () => void
  onGesteSurvol: () => void
  onEtendreClavier: (pas: number) => void
  onAbandonner: () => void
}) {
  // L'appui long **termine** le geste qu'il interrompt : le doigt qui continue
  // sa route après l'ouverture du formulaire étendait sinon une sélection
  // derrière la boîte — « 2 jours sélectionnés » sous un formulaire qui ne
  // s'applique qu'à une seule date.
  const appuiLong = useLongPress(() => {
    onGesteAbandon()
    onFormulaire()
  })

  // Week-ends et fériés : grisés, jamais interdits.
  const jourDit = etatJour(jour)
  const titreJour = TITRE_JOUR[jourDit]
  // L'occupation s'ajoute à ce que la case disait déjà : un férié occupé reste
  // un férié, et un marqueur muet ne dirait rien à qui ne le voit pas. Le jour
  // courant et le prévisionnel s'y ajoutent de la même façon : ni le trait
  // épais ni l'horloge ne se lisent d'eux-mêmes.
  const detail = [
    aujourdhui ? 'Aujourd’hui' : undefined,
    titreJour,
    description(etat, slots),
    previsionnel ? 'Prévisionnel' : undefined,
    occupe ? OCCUPATION_TITRE : undefined,
  ]
    .filter((t) => t !== undefined)
    .join(' — ')

  const forme = formeDeLaCase(etat, saisies, slots)
  const remplie = forme.kind !== 'AUCUNE'

  // La densité compacte perd le libellé — les valeurs en heures ou en
  // créneau ne survivent pas à la réduction —, jamais l'aplat qui le remplace
  // déjà à l'œil : `remplie` reste vrai, seul le chiffre disparaît.
  const valeur = densite === 'COMPACTE' ? '' : contenu(etat, slots, line, saisies)

  // Le passé est froid, le futur est chaud : le prévisionnel prend sa teinte
  // au lieu d'emprunter celle de la prestation. Le tireté de la case porte la
  // même information sans la couleur, et l'horloge reste — elle nomme l'état
  // dans l'infobulle et dans le nom accessible.
  const couleurDeLaCase = previsionnel ? PREVU_COLOR : couleur

  return (
    // Sans gouttière : les libellés des autres prestations se posent sous la
    // case, et une gouttière ici les mettait à égale distance de leur propre
    // case et de la case de la semaine suivante — une barre entre deux
    // semaines, attachée à rien. Elle se retire ici et **jamais** en
    // élargissant celle de la grille : celle-là est ce qui laisse aux sept
    // colonnes leurs 44 points sur un écran de 375.
    <div className="flex flex-col">
      <button
        type="button"
        data-testid={`case-${jour.date}`}
        data-date={jour.date}
        data-jour={jourDit}
        data-busy={occupe ? 'true' : undefined}
        data-aujourdhui={aujourdhui ? 'true' : undefined}
        data-plage={position}
        aria-label={`${line.label} le ${jour.date} — ${detail}`}
        title={detail}
        onPointerDown={(ev) => {
          appuiLong.handlers.onPointerDown(ev)
          // Sans relâcher la capture implicite, tous les événements du doigt
          // restent adressés à cette case : aucune autre ne le verrait passer,
          // et le glissement n'existerait toujours qu'à la souris.
          const cible = ev.currentTarget
          if (
            typeof cible.hasPointerCapture === 'function' &&
            ev.pointerId !== undefined &&
            cible.hasPointerCapture(ev.pointerId)
          ) {
            cible.releasePointerCapture(ev.pointerId)
          }
          onGesteDebut()
        }}
        onPointerMove={appuiLong.handlers.onPointerMove}
        onPointerEnter={onGesteSurvol}
        onPointerUp={appuiLong.handlers.onPointerUp}
        onPointerLeave={appuiLong.handlers.onPointerLeave}
        onPointerCancel={appuiLong.handlers.onPointerCancel}
        onClick={() => {
          // L'appui long a déjà ouvert le formulaire : le clic qui le suit ne
          // doit pas faire avancer la case d'un cran derrière lui.
          if (appuiLong.consommerAppuiLong()) return
          // Le glissement, lui, a sélectionné une plage : au doigt, le `click`
          // qui le termine est adressé à la case où il a commencé.
          if (consommerGlissement()) return
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
            return
          }
          // Maj+flèche étend la sélection et emmène le focus avec elle : sans
          // cela, le glissement — donc la barre et ses boutons — n'avait aucun
          // équivalent au clavier.
          const pas = ev.shiftKey ? PAS_DE_FLECHE[ev.key] : undefined
          if (pas !== undefined) {
            ev.preventDefault()
            onEtendreClavier(pas)
            return
          }
          if (ev.key === 'Escape') onAbandonner()
        }}
        // `relative` et `overflow-hidden` : l'aplat est posé en absolu dans la
        // case, et sa découpe ne doit pas déborder du coin arrondi.
        //
        // Le jour courant se distingue par un trait épais, jamais par la seule
        // teinte — et il se distingue quel que soit le contenu de la case,
        // parce que c'est là que passe la frontière entre réalisé et
        // prévisionnel.
        // Ni le rayon ni le débordement ne sont posés ici : `PLAGE_CLASSES` les
        // porte, et vient en dernier pour l'emporter sur les filets déclarés
        // au-dessus. Les poser deux fois laisserait l'ordre d'insertion CSS
        // trancher — précisément ce que `cn()` existe pour empêcher.
        className={cn(
          'touch-target relative flex aspect-square flex-col items-center justify-center text-sm tabular-nums',
          FOND_JOUR[jourDit],
          aujourdhui ? 'border-2 border-ink' : 'border border-rule',
          // Le tireté dit le prévisionnel sans la teinte : deux aplats opaques
          // ne se distingueraient pas en vision monochrome.
          //
          // La teinte du filet accompagne le tireté, et c'est `prevuEdge` — la
          // même que le tableau, la légende et la barre d'engagement posent par
          // `SEGMENT_PREVU_BORDURE`. Le calendrier gardait ici son filet neutre :
          // les deux vues du *même* écran peignaient donc le même fait de deux
          // couleurs, ce que ce lot existe pour supprimer.
          //
          // Sauf aujourd'hui : le trait épais d'encre est le repère qui sépare
          // le réalisé du prévisionnel, et rien ne doit le repeindre. Un jour
          // courant prévisionnel garde donc son encre, et le tireté suffit.
          previsionnel && (aujourdhui ? 'border-dashed' : 'border-dashed border-prevu-edge'),
          // Anneau **intérieur** et non `ring-*` : `ring-1 ring-warning-edge`
          // et le `ring-2 ring-focus` de la sélection tombent dans les mêmes
          // groupes `ring-w` et `ring-color`, et `cn()` ne garde alors que le
          // dernier — l'avertissement disparaissait à l'instant précis où la
          // case est sélectionnée pour être corrigée. `inset-ring-*` compose
          // dans `--tw-inset-ring-shadow`, une couche distincte de
          // `--tw-ring-shadow` : les deux marqueurs se voient ensemble, le
          // liseré d'éclatement par-dessus la bague de sélection.
          etat.kind === 'LIBRE' && etat.eclatee && 'inset-ring-1 inset-ring-warning-edge',
          remplie ? 'text-ink' : 'text-muted',
          previsionnel && 'italic',
          selected && 'ring-2 ring-inset ring-focus',
          PLAGE_CLASSES[position],
        )}
      >
        <Aplat
          cle={jour.date}
          forme={forme}
          couleur={couleurDeLaCase}
          className={PLAGE_APLAT[position]}
        />

        {/* Après l'aplat, jamais avant : sans z-index, c'est l'ordre du
            document qui décide, et le coin doit se poser par-dessus la teinte
            qu'il traverse. */}
        {etat.kind === 'LIBRE' && etat.eclatee && <CoinEclate cle={jour.date} />}

        {/* `relative` : le contenu passe au-dessus de l'aplat, qui est le seul
            nœud positionné en absolu de la case. */}
        <span className="relative flex items-center gap-0.5 text-xs leading-none">
          {Number(jour.date.slice(8))}
          {occupe && (
            <IconeOccupation testId={`occupation-${jour.date}`} className="shrink-0" />
          )}
          {/* Le prévisionnel garde le remplissage du réalisé : c'est cette
              horloge, et elle seule, qui les sépare. */}
          {previsionnel && <Horloge date={jour.date} />}
        </span>
        {/* Le numéro du jour et la valeur sont deux nœuds distincts : les mêler
            rendrait « la case est vide » indistinguable de « la case affiche 10 ». */}
        <span data-testid={`valeur-${jour.date}`} className="relative leading-tight">
          {valeur}
        </span>
      </button>
      {autres.map((a) => {
        const couleur = colorForLine(a.id)
        return (
          <span
            key={a.id}
            data-testid={`autre-${a.id}-${jour.date}`}
            title={`${a.label} — lecture seule`}
            // Coins hauts vifs : le libellé continue la case au lieu de
            // flotter sous elle. Le premier reprend le coin arrondi du bas.
            className={`truncate rounded-b-sm border px-1 text-[10px] ${couleur.bg} ${couleur.text} ${couleur.border}`}
          >
            {a.label}
          </span>
        )
      })}
    </div>
  )
}
