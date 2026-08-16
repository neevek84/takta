import { requireApiToken } from '@/services/api-token'
import { readAuditSince } from '@/services/audit'
import { buildEventPayload } from '@/core/webhooks/payload'
import { isAuditAction } from '@/core/audit/events'

/** Le journal est lu à la demande : jamais de cache statique sur cette route. */
export const dynamic = 'force-dynamic'

const LIMITE_DEFAUT = 100
const LIMITE_MAX = 500

function entierPositif(brut: string | null, defaut: number, minimum: number): number | null {
  if (brut === null) return defaut
  const valeur = Number(brut)
  if (!Number.isInteger(valeur) || valeur < minimum) return null
  return valeur
}

/**
 * Le flux d'événements, tiré par le consommateur.
 *
 * **L'application expose, elle n'appelle personne** : n8n, un script, ou ce
 * qui remplacera n8n mémorise `derniereSeq` et reprend là où il s'était
 * arrêté. Aucun événement ne se perd, même après plusieurs jours d'arrêt.
 *
 * **Le curseur sous filtre.** Avec `event=`, `derniereSeq` est le dernier seq
 * correspondant au filtre. Un consommateur qui garde un curseur par filtre est
 * correct ; un consommateur qui partage un curseur entre deux filtres se
 * trompe. C'est le comportement attendu d'un flux filtré, et il vaut mieux
 * qu'un curseur global qui ferait sauter des événements du filtre.
 */
export async function GET(request: Request): Promise<Response> {
  const garde = requireApiToken(request)
  if (!garde.ok) return garde.response

  const parametres = new URL(request.url).searchParams

  const since = entierPositif(parametres.get('since'), 0, 0)
  if (since === null) {
    return Response.json(
      { erreur: 'Le paramètre « since » doit être un entier positif ou nul.' },
      { status: 400 },
    )
  }

  const limit = entierPositif(parametres.get('limit'), LIMITE_DEFAUT, 1)
  if (limit === null) {
    return Response.json(
      { erreur: 'Le paramètre « limit » doit être un entier strictement positif.' },
      { status: 400 },
    )
  }

  const event = parametres.get('event')
  if (event !== null && !isAuditAction(event)) {
    return Response.json(
      { erreur: `L'événement « ${event} » n'existe pas au catalogue.` },
      { status: 400 },
    )
  }

  const entries = await readAuditSince({
    since,
    limit: Math.min(limit, LIMITE_MAX),
    ...(event !== null && { action: event }),
  })

  const events = entries.map(buildEventPayload)

  return Response.json({
    events,
    nombre: events.length,
    // Rien de neuf : on rend au consommateur son propre curseur, pour qu'il
    // ne recule pas à zéro au prochain tour.
    derniereSeq: events.length === 0 ? since : events[events.length - 1]!.seq,
  })
}
