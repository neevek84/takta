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

/**
 * Une pause incluse dans un bloc, en minutes depuis minuit.
 *
 * Elle ne franchit jamais minuit, et un bloc de nuit n'en porte pas : la pause
 * déjeuner est la seule qu'on connaisse, et elle tombe en pleine journée.
 */
export interface Pause {
  debutMinute: number
  finMinute: number
}

/** Durée d'une pause, en minutes ; 0 quand il n'y en a pas. */
export function pauseMinutes(pause: Pause | undefined): number {
  return pause === undefined ? 0 : Math.max(0, pause.finMinute - pause.debutMinute)
}

/**
 * Relit la pause portée par deux colonnes — celles d'une saisie ou des
 * réglages. Deux bornes égales disent « aucune pause » : c'est ce que vaut
 * toute saisie antérieure à la pause, écrite à 0 et 0.
 */
export function pauseDepuisColonnes(debutMinute: number, finMinute: number): Pause | undefined {
  return finMinute > debutMinute ? { debutMinute, finMinute } : undefined
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
  /**
   * pause déjeuner à inclure dans une journée sans créneau. Absente, aucune.
   * C'est l'appelant qui décide qu'une saisie est une journée entière : ce
   * calcul ne fait que placer la pause quand on la lui donne.
   */
  pause?: Pause
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
 * personne n'a vendue serait pire que de tronquer. Une pause donnée allonge le
 * bloc d'autant, jamais au-delà de la plage.
 */
export function entryBounds(args: EntryBoundsArgs): {
  startMinute: number
  endMinute: number
  /** présente seulement si la pause tombe réellement dans le bloc */
  pause?: Pause
} {
  if (args.slot !== null) {
    return { startMinute: args.slot.startMinute, endMinute: args.slot.endMinute }
  }

  const debut = args.journeeDebutMinute
  const plage = Math.max(0, args.journeeFinMinute - debut)

  // La pause s'ajoute au temps saisi, elle ne le remplace pas : 7 h facturées
  // occupent 8 h d'agenda. Elle ne s'applique que si elle tombe strictement
  // dans le bloc ainsi allongé — une matinée de deux heures n'a rien à couper.
  const duree = pauseMinutes(args.pause)
  if (args.pause !== undefined && duree > 0) {
    const finAvecPause = debut + args.minutes + duree
    const fin = Math.min(finAvecPause, args.journeeFinMinute)
    if (args.pause.debutMinute > debut && args.pause.finMinute < fin) {
      return { startMinute: debut, endMinute: fin % MINUTES_PER_DAY, pause: { ...args.pause } }
    }
  }

  const fin = debut + Math.min(args.minutes, plage)
  // Minuit se note 0, jamais 1440 : les deux bornes vivent dans la même plage
  // 0-1439 que celles d'un créneau, et `minutesBetween` retrouve la durée.
  return { startMinute: debut, endMinute: fin % MINUTES_PER_DAY }
}

export function slotInterval(slot: Slot, date: Date): { start: Date; end: Date } {
  const start = new Date(date.getTime() + slot.startMinute * 60_000)
  const end = new Date(start.getTime() + slotDurationMinutes(slot) * 60_000)
  return { start, end }
}
