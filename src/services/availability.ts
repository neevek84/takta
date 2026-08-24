import type { BusyInterval, CalendarConnector } from '@/core/calendar/connector'
import type { FetchLike } from '@/integrations/google/calendar'
import { resolveConnector } from './sync/connector'

/** L'agenda principal suffit en v1 ; le multi-agendas est hors périmètre. */
const AGENDA_PRINCIPAL = 'primary'

const JOUR_MS = 86_400_000

/**
 * `startIso` au début du jour `du`, `endIso` au début du lendemain de `au` —
 * borne ouverte à droite, comme le mois qu'elle remplace.
 */
function bornesIso(args: { du: string; au: string }): { startIso: string; endIso: string } {
  const debutDu = new Date(`${args.du}T00:00:00.000Z`).getTime()
  const debutAu = new Date(`${args.au}T00:00:00.000Z`).getTime()
  return {
    startIso: new Date(debutDu).toISOString(),
    endIso: new Date(debutAu + JOUR_MS).toISOString(),
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
 * Au-delà de ce délai, l'appel rend un échec plutôt que d'attendre.
 *
 * Le `catch` de `getBusyRange` protège d'un agenda **en panne**. Il ne
 * protège de rien contre un agenda **lent**, qui répondra — dans trente
 * secondes — et retiendrait d'ici là l'appelant. Une panne franche était le
 * cas facile ; la lenteur est celui qui se voit à l'usage.
 */
export const DELAI_OCCUPATION_MS = 3000

export type RaisonAgenda = 'PAS_DE_CONNECTEUR' | 'ECHEC'

export type ResultatAgenda = { ok: true; jours: string[] } | { ok: false; raison: RaisonAgenda }

/**
 * Les jours d'une plage porteurs d'une occupation dans l'agenda principal.
 *
 * **Ne lève jamais** — la garantie n'a pas changé. Ce qui change, c'est
 * qu'elle sait désormais dire *pourquoi* elle ne rend rien.
 *
 * Tant que la lecture était automatique, une liste vide se lisait « rien à
 * signaler » et suffisait : le repère apparaissait ou non, et c'était un
 * confort. Depuis qu'elle n'a lieu que si l'utilisateur **clique**, une liste
 * vide qui signifie « Google n'a pas répondu » est un mensonge : il a demandé,
 * il doit obtenir une réponse honnête.
 *
 * Les journées sont découpées en temps universel, comme les bornes de la
 * plage : une occupation qui commence après 23 h locales en hiver — minuit
 * UTC — se lit donc sur le lendemain. Le repère reste juste à la journée près
 * pour tout ce qui se passe en journée de travail ; l'affiner demanderait de
 * porter le fuseau jusqu'ici, ce qui n'a pas été tranché pour ce lot.
 */
export async function getBusyRange(
  userId: string,
  args: { du: string; au: string },
  deps: { connector?: CalendarConnector | null; fetchFn?: FetchLike; delaiMs?: number } = {},
): Promise<ResultatAgenda> {
  const delaiMs = deps.delaiMs ?? DELAI_OCCUPATION_MS

  try {
    return await Promise.race([
      lireOccupation(userId, args, deps),
      new Promise<ResultatAgenda>((_, rejeter) =>
        setTimeout(() => rejeter(new Error('Délai dépassé')), delaiMs).unref?.(),
      ),
    ])
  } catch {
    // Le seul `catch` muet que ce service s'autorise — mais il ne rend plus
    // une liste vide indistinguable d'une plage libre.
    return { ok: false, raison: 'ECHEC' }
  }
}

async function lireOccupation(
  userId: string,
  args: { du: string; au: string },
  deps: { connector?: CalendarConnector | null; fetchFn?: FetchLike },
): Promise<ResultatAgenda> {
  const connector =
    deps.connector !== undefined
      ? deps.connector
      : await resolveConnector(userId, {
          ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
        })
  if (connector === null) return { ok: false, raison: 'PAS_DE_CONNECTEUR' }

  const { startIso, endIso } = bornesIso(args)
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
      if (args.du <= jour && jour <= args.au) jours.add(jour)
    }
  }
  return { ok: true, jours: [...jours].sort() }
}
