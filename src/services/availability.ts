import type { BusyInterval, CalendarConnector } from '@/core/calendar/connector'
import type { FetchLike } from '@/integrations/google/calendar'
import { resolveConnector } from './sync/connector'

/** L'agenda principal suffit en v1 ; le multi-agendas est hors périmètre. */
const AGENDA_PRINCIPAL = 'primary'

const JOUR_MS = 86_400_000

function monthBoundsIso(month: string): { startIso: string; endIso: string } {
  const [y, m] = month.split('-').map(Number) as [number, number]
  // `Date.UTC(y, 12, 1)` bascule sur janvier de l'année suivante : décembre
  // n'a pas besoin d'un cas particulier, et n'en aura jamais.
  return {
    startIso: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    endIso: new Date(Date.UTC(y, m, 1)).toISOString(),
  }
}

/** Tous les jours qu'une plage touche, bornes ouvertes à droite. */
function joursCouverts(interval: BusyInterval): string[] {
  const debut = new Date(interval.startIso).getTime()
  const fin = new Date(interval.endIso).getTime()
  // Une plage vide, inversée ou illisible ne marque rien : inventer un jour
  // occupé à partir d'une donnée qu'on ne comprend pas serait pire que de ne
  // rien marquer.
  if (Number.isNaN(debut) || Number.isNaN(fin) || fin <= debut) return []

  const jours: string[] = []
  let curseur = Math.floor(debut / JOUR_MS) * JOUR_MS
  // Une réunion de 22 h à 6 h occupe deux journées, pas une — et une semaine
  // de congés en occupe cinq, pas seulement ses deux bornes.
  while (curseur < fin) {
    jours.push(new Date(curseur).toISOString().slice(0, 10))
    curseur += JOUR_MS
  }
  return jours
}

/**
 * Les jours du mois porteurs d'une occupation dans l'agenda principal.
 *
 * **Ne lève jamais.** Compte non connecté, appel en échec, appel expiré,
 * autorisation révoquée, clé de chiffrement perdue : la liste est vide et la
 * grille s'affiche sans marques. La détection de conflit est un confort, pas
 * une dépendance — la saisie doit continuer de fonctionner un jour où Google
 * est en panne.
 *
 * Les journées sont découpées en temps universel, comme les bornes du mois :
 * une occupation qui commence après 23 h locales en hiver — minuit UTC — se
 * lit donc sur le lendemain. Le repère reste juste à la journée près pour tout
 * ce qui se passe en journée de travail ; l'affiner demanderait de porter le
 * fuseau jusqu'ici, ce qui n'a pas été tranché pour ce lot.
 *
 * Aucun cache en v1 : un appel `freeBusy` est bon marché, et un cache
 * introduirait une fraîcheur à arbitrer.
 */
/**
 * Au-delà de ce délai, la grille s'affiche sans marquage.
 *
 * Le `catch` ci-dessous protège d'un agenda **en panne**. Il ne protège de
 * rien contre un agenda **lent**, qui répondra — dans trente secondes — et
 * retiendra d'ici là l'affichage de la saisie. Une panne franche était le cas
 * facile ; la lenteur est celui qui se voit à l'usage.
 *
 * Le marquage est une information, jamais un blocage : il ne vaut pas d'être
 * attendu.
 */
export const DELAI_OCCUPATION_MS = 3000

export async function getBusyDays(
  userId: string,
  month: string,
  deps: {
    connector?: CalendarConnector | null
    fetchFn?: FetchLike
    delaiMs?: number
  } = {},
): Promise<string[]> {
  const delaiMs = deps.delaiMs ?? DELAI_OCCUPATION_MS

  try {
    return await Promise.race([
      lireOccupation(userId, month, deps),
      new Promise<string[]>((_, rejeter) =>
        setTimeout(() => rejeter(new Error('Délai dépassé')), delaiMs).unref?.(),
      ),
    ])
  } catch {
    // Le seul `catch` muet que ce service s'autorise, et la raison d'être de
    // sa signature : l'appelant est une page de saisie qui doit s'afficher.
    return []
  }
}

async function lireOccupation(
  userId: string,
  month: string,
  deps: { connector?: CalendarConnector | null; fetchFn?: FetchLike },
): Promise<string[]> {
  {
    const connector =
      deps.connector !== undefined
        ? deps.connector
        : await resolveConnector(userId, {
            ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
          })
    if (connector === null) return []

    const { startIso, endIso } = monthBoundsIso(month)
    const plages = await connector.freeBusy({
      startIso,
      endIso,
      // Le calendrier dédié est passé explicitement pour que le connecteur
      // l'écarte : l'exclusion est une propriété vérifiable, pas un oubli.
      calendarIds: [AGENDA_PRINCIPAL, connector.dedicatedCalendarId],
    })

    const jours = new Set<string>()
    for (const plage of plages) {
      for (const jour of joursCouverts(plage)) {
        if (jour.startsWith(month)) jours.add(jour)
      }
    }
    return [...jours].sort()
  }
}
