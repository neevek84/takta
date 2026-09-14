import { minutesBetween, type Pause } from '../time/slots'
import type { TimeEntryKind } from '../types'

/** Identifiants de couleur Google : Myrtille pour le réalisé, Banane pour le prévu. */
export const COULEUR_REALISE = '9'
export const COULEUR_PREVISIONNEL = '5'
/** Graphite : un trajet occupe, mais ne se confond ni avec le réalisé ni avec le prévu. */
export const COULEUR_TRAJET = '8'

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
  /** retrouvé côté Google dans extendedProperties.private ; vide pour un trajet */
  craEntryId: string
  /** `'apres-pause'` sur le second bloc d'une journée coupée ; absent sinon */
  craSegment?: string
  /** identifiant du trajet ; absent pour un bloc de travail */
  craTrajetId?: string
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

export const SEGMENT_APRES_PAUSE = 'apres-pause'

export type Segment = 'PRINCIPAL' | 'APRES_PAUSE'

/**
 * Les blocs d'agenda d'une saisie : un seul, ou deux quand une pause la coupe.
 *
 * Un événement Google n'a pas de trou. Poser un bloc de 9 h à 17 h et écrire
 * la pause en description laisserait l'agenda annoncer occupé à midi — le
 * contraire de ce que la pause veut dire. Le premier bloc garde exactement la
 * forme d'aujourd'hui, pour que les liens déjà posés continuent de le désigner.
 */
export function buildCalendarEvents(
  args: BuildEventArgs & { pause?: Pause },
): Array<{ segment: Segment; draft: CalendarEventDraft }> {
  if (args.pause === undefined) {
    return [{ segment: 'PRINCIPAL', draft: buildCalendarEvent(args) }]
  }

  return [
    { segment: 'PRINCIPAL', draft: buildCalendarEvent({ ...args, endMinute: args.pause.debutMinute }) },
    {
      segment: 'APRES_PAUSE',
      draft: {
        ...buildCalendarEvent({ ...args, startMinute: args.pause.finMinute }),
        craSegment: SEGMENT_APRES_PAUSE,
      },
    },
  ]
}

/**
 * Le bloc d'un trajet. Il occupe l'agenda comme un bloc de travail, mais ne
 * porte aucun `craEntryId` : l'application ne le relira jamais, et rien ne
 * doit pouvoir le prendre pour une saisie.
 */
export function buildTrajetEvent(args: {
  trajetId: string
  /** 'YYYY-MM-DD' */
  date: string
  startMinute: number
  endMinute: number
  summary: string
  timeZone: string
}): CalendarEventDraft {
  return {
    summary: args.summary,
    description:
      'Trajet posé par takta. Vous pouvez le déplacer ou le supprimer : l’application ne le suivra plus.',
    startLocal: localAt(args.date, args.startMinute),
    endLocal: localAt(args.date, args.startMinute + minutesBetween(args.startMinute, args.endMinute)),
    timeZone: args.timeZone,
    transparency: 'opaque',
    colorId: COULEUR_TRAJET,
    craEntryId: '',
    craTrajetId: args.trajetId,
  }
}
