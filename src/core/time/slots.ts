const MINUTES_PER_DAY = 1440

export interface Slot {
  id: string
  label: string
  /** minutes depuis minuit, 0-1439 */
  startMinute: number
  /** minutes depuis minuit, 0-1439 */
  endMinute: number
  /** valeur du créneau en centièmes de jour */
  centiemes: number
}

export function crossesMidnight(slot: Slot): boolean {
  return slot.endMinute <= slot.startMinute
}

/**
 * Minutes écoulées entre deux bornes exprimées depuis minuit.
 *
 * Une fin antérieure — ou égale — au début n'est pas une erreur de saisie : le
 * bloc franchit minuit, ce que le porteur fait réellement certaines nuits. Deux
 * bornes confondues valent donc 24 h, jamais 0 : une saisie de durée nulle
 * n'existe pas, et l'interpréter ainsi ferait disparaître le bloc en silence.
 */
export function minutesBetween(startMinute: number, endMinute: number): number {
  return endMinute <= startMinute
    ? MINUTES_PER_DAY - startMinute + endMinute
    : endMinute - startMinute
}

export function slotDurationMinutes(slot: Slot): number {
  return minutesBetween(slot.startMinute, slot.endMinute)
}

export interface EntryBoundsArgs {
  /** temps saisi, en minutes */
  minutes: number
  /** créneau nommé porté par la saisie ; `null` = journée entière */
  slot: Slot | null
  /** début de la plage journée, minutes depuis minuit */
  journeeDebutMinute: number
  /** fin de la plage journée, minutes depuis minuit */
  journeeFinMinute: number
}

/**
 * Les bornes qu'une saisie **fige à son écriture**.
 *
 * Même règle que le facteur de conversion, et pour la même raison : redéfinir
 * « Matin » en administration ne doit déplacer aucune journée déjà saisie. Le
 * calcul vivait auparavant dans `buildCalendarEvent`, c'est-à-dire du côté de
 * la *lecture* — une colonne parfaitement intacte en base n'aurait rien
 * protégé tant qu'un lecteur reconstruisait les horaires depuis les réglages
 * courants.
 *
 * Un créneau nommé dit *quand* ; la durée saisie sert au CRA, pas au placement.
 * Sans créneau, le bloc part au début de la plage journée et dure exactement le
 * temps saisi, sans jamais déborder de la plage — occuper une soirée que
 * personne n'a vendue serait pire que de tronquer.
 */
export function entryBounds(args: EntryBoundsArgs): {
  startMinute: number
  endMinute: number
} {
  if (args.slot !== null) {
    return { startMinute: args.slot.startMinute, endMinute: args.slot.endMinute }
  }

  const plage = Math.max(0, args.journeeFinMinute - args.journeeDebutMinute)
  const fin = args.journeeDebutMinute + Math.min(args.minutes, plage)
  // Minuit se note 0, jamais 1440 : les deux bornes vivent dans la même plage
  // 0-1439 que celles d'un créneau, et `minutesBetween` retrouve la durée.
  return { startMinute: args.journeeDebutMinute, endMinute: fin % MINUTES_PER_DAY }
}

export function slotInterval(slot: Slot, date: Date): { start: Date; end: Date } {
  const start = new Date(date.getTime() + slot.startMinute * 60_000)
  const end = new Date(start.getTime() + slotDurationMinutes(slot) * 60_000)
  return { start, end }
}
