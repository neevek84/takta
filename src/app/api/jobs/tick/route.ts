import { requireApiToken } from '@/services/api-token'
import { tick } from '@/services/jobs/scheduler'

export const dynamic = 'force-dynamic'

/**
 * Réveille l'ordonnanceur. Appelé toutes les cinq minutes par n'importe quel
 * déclencheur — cron, n8n, un timer systemd — il suffit à tout.
 *
 * `POST` et non `GET` : le réveil a des effets, et un `GET` serait
 * déclenchable par un préchargement de navigateur.
 */
export async function POST(request: Request): Promise<Response> {
  const garde = requireApiToken(request)
  if (!garde.ok) return garde.response

  return Response.json(await tick())
}
