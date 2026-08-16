import { minutesBetween } from '../time/slots'
import type { TimeEntryKind } from '../types'

/** Identifiants de couleur Google : Myrtille pour le réalisé, Banane pour le prévu. */
export const COULEUR_REALISE = '9'
export const COULEUR_PREVISIONNEL = '5'

export interface CalendarEventDraft {
  summary: string
  description: string
  /** heure locale naïve, 'YYYY-MM-DDTHH:MM:SS' — le fuseau est porté à part */
  startLocal: string
  endLocal: string
  /** fuseau IANA, ex. 'Europe/Paris' */
  timeZone: string
  /** le but même du bloc : occuper la plage */
  transparency: 'opaque'
  colorId: string
  /** retrouvé côté Google dans extendedProperties.private */
  craEntryId: string
}

export interface BuildEventArgs {
  entryId: string
  /** 'YYYY-MM-DD' */
  date: string
  kind: TimeEntryKind
  clientName: string
  missionLabel: string
  lineLabel: string
  /**
   * Bornes **figées à l'écriture de la saisie**, en minutes depuis minuit.
   *
   * Elles étaient auparavant reconstruites ici, à partir du créneau et de la
   * plage journée lus dans les réglages **courants** : redéfinir « Matin » en
   * administration déplaçait alors le bloc d'une journée déjà saisie, CRA
   * validé compris. Le gel se cassait en lecture, pas en écriture — d'où le
   * calcul déplacé chez l'écrivain (`entryBounds`), et ce constructeur qui ne
   * fait plus que reporter ce que la saisie porte.
   */
  startMinute: number
  endMinute: number
  timeZone: string
}

/**
 * Décale une date locale de N minutes et rend une heure locale naïve.
 *
 * L'arithmétique se fait en UTC sur une horloge murale traitée comme telle :
 * aucun décalage n'est appliqué, le fuseau reste porté par `timeZone`. C'est ce
 * qui rend la fonction pure et le franchissement de minuit trivial.
 */
function localAt(date: string, minutesFromMidnight: number): string {
  const minuit = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  )
  return new Date(minuit + minutesFromMidnight * 60_000).toISOString().slice(0, 19)
}

export function buildCalendarEvent(args: BuildEventArgs): CalendarEventDraft {
  // Une fin antérieure ou égale au début n'est pas une erreur de saisie : le
  // bloc franchit minuit, et `localAt` le porte sur le lendemain sans cas
  // particulier.
  const debut = args.startMinute
  const fin = debut + minutesBetween(args.startMinute, args.endMinute)

  const nature = args.kind === 'REALISE' ? 'réalisé' : 'prévisionnel'

  return {
    summary: `${args.clientName} · ${args.missionLabel} · ${args.lineLabel}`,
    description: `Bloc ${nature} posé par le CRA. Ne pas modifier ici : la saisie fait foi.`,
    startLocal: localAt(args.date, debut),
    endLocal: localAt(args.date, fin),
    timeZone: args.timeZone,
    transparency: 'opaque',
    colorId: args.kind === 'REALISE' ? COULEUR_REALISE : COULEUR_PREVISIONNEL,
    craEntryId: args.entryId,
  }
}
