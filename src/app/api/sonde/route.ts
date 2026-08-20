import { getInstanceCredential, readInstanceSecret } from '@/services/credentials'
import { DOLIBARR } from '@/services/dolibarr/api'
export async function GET(): Promise<Response> {
  const c = await getInstanceCredential(DOLIBARR)
  const secret = await readInstanceSecret(DOLIBARR)
  if (c === null || secret === null) return Response.json({ erreur: 'pas de credential' })
  const r = await fetch(`${c.baseUrl}/tasks/34`, {
    headers: { DOLAPIKEY: secret, 'Content-Type': 'application/json' },
  })
  const t = (await r.json()) as Record<string, unknown>
  return Response.json({
    statut: r.status,
    champs: t.array_options,
    duree_effective: t.duration_effective,
    planifiee: t.planned_workload,
  })
}
