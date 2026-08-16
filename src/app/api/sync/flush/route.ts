import { timingSafeEqual } from 'node:crypto'
import { flushAllSyncOutboxes } from '@/services/sync/flush'

/** Comparaison à durée constante : un jeton ne se devine pas octet par octet. */
function jetonValide(header: string): boolean {
  const attendu = process.env.SYNC_FLUSH_TOKEN ?? ''
  // Aucun jeton configuré = endpoint fermé. Un déploiement qui oublie la
  // variable ne doit pas ouvrir la synchronisation à tout le monde.
  if (attendu === '') return false

  const fourni = header.startsWith('Bearer ') ? header.slice(7) : ''
  const a = Buffer.from(fourni)
  const b = Buffer.from(attendu)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Le déclenchement appelable de l'extérieur : un cron système, n8n, ou un
 * `curl`. Il porte son propre jeton parce qu'il n'a pas de session — et il
 * reste fermé par défaut, puisqu'il écrit dans l'agenda d'autrui.
 *
 * Rien ne l'exige : le bouton « Synchroniser maintenant » suffit à
 * l'autoportance de l'application.
 */
export async function POST(request: Request): Promise<Response> {
  if (!jetonValide(request.headers.get('authorization') ?? '')) {
    return Response.json({ error: 'Jeton de synchronisation invalide.' }, { status: 401 })
  }

  const r = await flushAllSyncOutboxes()
  return Response.json(r, { status: 200 })
}
