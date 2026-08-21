'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/auth'
import { prisma } from '@/db/client'
import {
  archiverClient,
  archiverMission,
  impactSuppressionClient,
  supprimerClient,
  type ImpactSuppression,
} from '@/services/archivage'

export type DonneesState = { ok: true; message: string } | { ok: false; erreur: string } | null

export async function rangerClient(clientId: string, archive: boolean): Promise<DonneesState> {
  await requireUser()
  try {
    await archiverClient(clientId, archive)
    revalidatePath('/admin/donnees')
    revalidatePath('/missions')
    return { ok: true, message: archive ? 'Client archivé.' : 'Client désarchivé.' }
  } catch (err) {
    return { ok: false, erreur: err instanceof Error ? err.message : String(err) }
  }
}

export async function sortirMissionDeLArchive(missionId: string): Promise<DonneesState> {
  await requireUser()
  try {
    await archiverMission(missionId, false)
    revalidatePath('/admin/donnees')
    revalidatePath('/missions')
    return { ok: true, message: 'Mission désarchivée.' }
  } catch (err) {
    return { ok: false, erreur: err instanceof Error ? err.message : String(err) }
  }
}

/** Ce que la suppression d'un client emporterait, ses missions comprises. */
export async function chargerImpactClient(clientId: string): Promise<ImpactSuppression> {
  await requireUser()
  return impactSuppressionClient(clientId)
}

/**
 * Détruit un client et toutes ses missions.
 *
 * Le nom exact est exigé : la suppression emporte l'historique de toutes ses
 * missions, CRA signés compris, et un clic ne doit pas suffire.
 */
export async function detruireClient(
  clientId: string,
  confirmation: string,
): Promise<DonneesState> {
  await requireUser()

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { name: true },
  })
  if (client === null) return { ok: false, erreur: 'Ce client n’existe plus.' }
  if (confirmation.trim() !== client.name) {
    return {
      ok: false,
      erreur: `Pour supprimer, recopiez exactement le nom du client : « ${client.name} ».`,
    }
  }

  try {
    const impact = await supprimerClient(clientId)
    revalidatePath('/admin/donnees')
    revalidatePath('/missions')
    return {
      ok: true,
      message: `Client supprimé : ${impact.prestations} prestation(s), ${impact.saisies} saisie(s), ${impact.cras} CRA et ${impact.correspondances} correspondance(s). Rien n’a été supprimé dans Dolibarr.`,
    }
  } catch (err) {
    return { ok: false, erreur: err instanceof Error ? err.message : String(err) }
  }
}
