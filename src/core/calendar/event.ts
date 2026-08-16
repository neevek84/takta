import { slotDurationMinutes, type Slot } from '../time/slots'
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
  minutes: number
  kind: TimeEntryKind
  clientName: string
  missionLabel: string
  lineLabel: string
  /** créneau porté par la saisie ; `null` pour une saisie à la journée */
  slot: Slot | null
  journeeDebutMinute: number
  journeeFinMinute: number
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

/**
 * Sans créneau : départ au début de la plage, durée exactement égale au temps
 * saisi, et jamais de débordement au-delà de la fin de plage. Une seule règle,
 * qui couvre journée, demi-journée et heures sans cas particulier.
 */
function journeeBounds(args: BuildEventArgs): [number, number] {
  const plage = Math.max(0, args.journeeFinMinute - args.journeeDebutMinute)
  return [args.journeeDebutMinute, args.journeeDebutMinute + Math.min(args.minutes, plage)]
}

export function buildCalendarEvent(args: BuildEventArgs): CalendarEventDraft {
  const [debut, fin] =
    args.slot === null
      ? journeeBounds(args)
      : [args.slot.startMinute, args.slot.startMinute + slotDurationMinutes(args.slot)]

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
