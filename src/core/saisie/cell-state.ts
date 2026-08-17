import { centiemesToMinutes } from '../time/units'
import { entryBounds } from '../time/slots'
import type { Slot } from '../time/slots'
import type { CellState } from './cycle'

export interface CellEntry {
  minutes: number
  /** '' = journée entière ; trace du créneau nommé, jamais une identité */
  slotId: string
  /** début du bloc, minutes depuis minuit — figé à l'écriture de la saisie */
  startMinute: number
  /** fin du bloc, minutes depuis minuit — figée à l'écriture de la saisie */
  endMinute: number
  /**
   * durée d'une journée, en minutes, **figée à l'écriture de cette saisie**.
   *
   * C'est sous ce facteur-là, et sous aucun autre, que la saisie se classe et
   * se convertit. La colonne existe en base depuis toujours ; ce type la
   * laissait tomber, et le classement retombait alors sur le réglage courant
   * de la prestation — un CRA validé changeait de calcul sans qu'aucune
   * écriture n'ait eu lieu.
   */
  minutesParJour: number
}

export interface DatedCellEntry extends CellEntry {
  /** 'YYYY-MM-DD' */
  date: string
  lineId: string
}

/**
 * Ce qu'il faut pour **lire** une case : les créneaux nommés, et rien d'autre.
 *
 * Ni la plage journée ni le facteur de conversion n'y figurent, et c'est
 * délibéré : les heures d'une saisie **et son facteur** sont figés à son
 * écriture, et une lecture qui aurait de quoi les recalculer finirait par le
 * faire — c'est exactement ainsi que le gel se casse. La règle du projet est
 * écrite : le gel se casse en lecture, pas en écriture. Retirer le facteur
 * courant d'ici est ce qui rend la faute impossible à réécrire.
 *
 * Chaque saisie porte le sien (`CellEntry.minutesParJour`).
 */
export interface CellReadContext {
  slots: readonly Slot[]
}

/**
 * Ce qu'il faut en plus pour **écrire** : le facteur de conversion sous lequel
 * la saisie va être figée, et les bornes de la journée de travail.
 */
export interface CellContext extends CellReadContext {
  /** facteur de conversion courant de la prestation, en minutes */
  minutesParJour: number
  /** début de la plage journée, minutes depuis minuit */
  journeeDebutMinute: number
  /** fin de la plage journée, minutes depuis minuit */
  journeeFinMinute: number
}

/**
 * Traduit les saisies d'une case en l'état que la cinématique manipule.
 *
 * Tout ce qui ne correspond pas exactement à une journée entière ou à la
 * valeur nominale d'un créneau connu devient `LIBRE` — y compris une journée
 * éclatée dont le total ferait pourtant illusion. C'est ce classement, et lui
 * seul, qui empêche le clic suivant d'écraser une saisie fine.
 */
export function readCellState(entries: readonly CellEntry[], ctx: CellReadContext): CellState {
  const utiles = entries.filter((e) => e.minutes > 0)
  if (utiles.length === 0) return { kind: 'VIDE' }

  if (utiles.length === 1) {
    const seule = utiles[0]!
    // Le facteur est celui de la saisie, **jamais** le réglage courant : une
    // journée écrite à 420 minutes reste une journée le jour où la prestation
    // passe à 480. Ses bornes la suivent, pour la même raison.
    const bornes = { startMinute: seule.startMinute, endMinute: seule.endMinute }
    if (seule.slotId === '' && seule.minutes === seule.minutesParJour) {
      return { kind: 'JOURNEE', bornes }
    }

    const slot = ctx.slots.find((s) => s.id === seule.slotId)
    if (
      slot !== undefined &&
      seule.minutes === centiemesToMinutes(slot.centiemes, seule.minutesParJour)
    ) {
      return { kind: 'DEMI', slotId: slot.id, bornes }
    }

    // Les bornes viennent de la saisie, **jamais** des réglages courants :
    // c'est exactement là que le gel se casserait en lecture, une colonne
    // intacte en base ne protégeant rien si un lecteur la recalcule.
    return {
      kind: 'LIBRE',
      minutes: seule.minutes,
      slotId: seule.slotId,
      startMinute: seule.startMinute,
      endMinute: seule.endMinute,
      eclatee: false,
    }
  }

  const minutes = utiles.reduce((somme, e) => somme + e.minutes, 0)
  // L'enveloppe de la journée éclatée : du premier début à la fin du bloc qui
  // commence le plus tard. Elle sert de pré-remplissage au formulaire, qui
  // remplacera l'ensemble par une seule saisie — d'où l'avertissement qu'il
  // affiche. Triée par début : la base ne promet aucun ordre.
  const parDebut = [...utiles].sort((a, b) => a.startMinute - b.startMinute)
  const premier = parDebut[0]!
  const dernier = parDebut[parDebut.length - 1]!
  return {
    kind: 'LIBRE',
    minutes,
    slotId: '',
    startMinute: premier.startMinute,
    endMinute: dernier.endMinute,
    eclatee: true,
  }
}

/**
 * Les saisies exactes que la case doit porter après application de `state`.
 *
 * Chacune part avec ses **deux bornes et son facteur**, calculés ici une fois
 * pour toutes : c'est le geste qui les fige. Les créneaux nommés n'y servent
 * qu'à pré-remplir — une fois écrites, les heures ne dépendent plus d'eux.
 *
 * Les `bornes` que la **lecture** reporte sur une journée ou une demi-journée
 * ne sont volontairement pas relues ici : écrire, c'est figer maintenant. Rien
 * n'apporte d'ailleurs un état lu jusqu'ici — la cinématique ne rend que des
 * crans neufs, et le formulaire n'envoie que des `LIBRE`.
 */
export function cellStateToWrite(state: CellState, ctx: CellContext): CellEntry[] {
  const bornes = (minutes: number, slot: Slot | null) =>
    entryBounds({
      minutes,
      slot,
      journeeDebutMinute: ctx.journeeDebutMinute,
      journeeFinMinute: ctx.journeeFinMinute,
    })

  // Le facteur du moment part avec chaque saisie : c'est ce geste-ci qui le
  // fige, exactement comme il fige les deux bornes.
  const minutesParJour = ctx.minutesParJour

  switch (state.kind) {
    case 'VIDE':
      return []
    case 'JOURNEE':
      return [
        {
          minutes: ctx.minutesParJour,
          slotId: '',
          ...bornes(ctx.minutesParJour, null),
          minutesParJour,
        },
      ]
    case 'DEMI': {
      const slot = ctx.slots.find((s) => s.id === state.slotId)
      if (slot === undefined) {
        throw new Error(`Créneau inconnu : « ${state.slotId} ».`)
      }
      const minutes = centiemesToMinutes(slot.centiemes, ctx.minutesParJour)
      return [{ minutes, slotId: slot.id, ...bornes(minutes, slot), minutesParJour }]
    }
    case 'LIBRE':
      // Le formulaire a dit le début et la fin ; on les écrit tels quels.
      return [
        {
          minutes: state.minutes,
          slotId: state.slotId,
          startMinute: state.startMinute,
          endMinute: state.endMinute,
          minutesParJour,
        },
      ]
  }
}

/** États de toutes les cases d'une prestation, indexés par date. */
export function buildCellStates(
  entries: readonly DatedCellEntry[],
  lineId: string,
  ctx: CellReadContext,
): Map<string, CellState> {
  const parDate = new Map<string, CellEntry[]>()
  for (const e of entries) {
    if (e.lineId !== lineId) continue
    const entree: CellEntry = {
      minutes: e.minutes,
      slotId: e.slotId,
      startMinute: e.startMinute,
      endMinute: e.endMinute,
      // Recopié, jamais laissé tomber : c'est ici que le facteur figé se
      // perdait, et le classement retombait sur le réglage courant.
      minutesParJour: e.minutesParJour,
    }
    const bucket = parDate.get(e.date)
    if (bucket === undefined) parDate.set(e.date, [entree])
    else bucket.push(entree)
  }

  const etats = new Map<string, CellState>()
  for (const [date, cellEntries] of parDate) {
    etats.set(date, readCellState(cellEntries, ctx))
  }
  return etats
}
