import { centiemesToMinutes } from '../time/units'
import type { Slot } from '../time/slots'
import type { CellState } from './cycle'

export interface CellEntry {
  minutes: number
  /** '' = journée entière */
  slotId: string
}

export interface DatedCellEntry extends CellEntry {
  /** 'YYYY-MM-DD' */
  date: string
  lineId: string
}

export interface CellContext {
  /** facteur de conversion de la prestation, en minutes */
  minutesParJour: number
  slots: readonly Slot[]
}

/**
 * Traduit les saisies d'une case en l'état que la cinématique manipule.
 *
 * Tout ce qui ne correspond pas exactement à une journée entière ou à la
 * valeur nominale d'un créneau connu devient `LIBRE` — y compris une journée
 * éclatée dont le total ferait pourtant illusion. C'est ce classement, et lui
 * seul, qui empêche le clic suivant d'écraser une saisie fine.
 */
export function readCellState(entries: readonly CellEntry[], ctx: CellContext): CellState {
  const utiles = entries.filter((e) => e.minutes > 0)
  if (utiles.length === 0) return { kind: 'VIDE' }

  if (utiles.length === 1) {
    const seule = utiles[0]!
    if (seule.slotId === '' && seule.minutes === ctx.minutesParJour) return { kind: 'JOURNEE' }

    const slot = ctx.slots.find((s) => s.id === seule.slotId)
    if (slot !== undefined && seule.minutes === centiemesToMinutes(slot.centiemes, ctx.minutesParJour)) {
      return { kind: 'DEMI', slotId: slot.id }
    }

    return { kind: 'LIBRE', minutes: seule.minutes, slotId: seule.slotId, eclatee: false }
  }

  const minutes = utiles.reduce((somme, e) => somme + e.minutes, 0)
  return { kind: 'LIBRE', minutes, slotId: '', eclatee: true }
}

/** Les saisies exactes que la case doit porter après application de `state`. */
export function cellStateToWrite(state: CellState, ctx: CellContext): CellEntry[] {
  switch (state.kind) {
    case 'VIDE':
      return []
    case 'JOURNEE':
      return [{ minutes: ctx.minutesParJour, slotId: '' }]
    case 'DEMI': {
      const slot = ctx.slots.find((s) => s.id === state.slotId)
      if (slot === undefined) {
        throw new Error(`Créneau inconnu : « ${state.slotId} ».`)
      }
      return [{ minutes: centiemesToMinutes(slot.centiemes, ctx.minutesParJour), slotId: slot.id }]
    }
    case 'LIBRE':
      return [{ minutes: state.minutes, slotId: state.slotId }]
  }
}

/** États de toutes les cases d'une prestation, indexés par date. */
export function buildCellStates(
  entries: readonly DatedCellEntry[],
  lineId: string,
  ctx: CellContext,
): Map<string, CellState> {
  const parDate = new Map<string, CellEntry[]>()
  for (const e of entries) {
    if (e.lineId !== lineId) continue
    const bucket = parDate.get(e.date)
    if (bucket === undefined) parDate.set(e.date, [{ minutes: e.minutes, slotId: e.slotId }])
    else bucket.push({ minutes: e.minutes, slotId: e.slotId })
  }

  const etats = new Map<string, CellState>()
  for (const [date, cellEntries] of parDate) {
    etats.set(date, readCellState(cellEntries, ctx))
  }
  return etats
}
