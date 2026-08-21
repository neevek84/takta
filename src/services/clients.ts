import { prisma } from '@/db/client'
import { appendAudit, actorOf } from './audit'

/**
 * `userId` est optionnel et en **dernière position** : la création d'un client
 * est une écriture d'instance, qui ne portait pas d'utilisateur. Le journal,
 * lui, a besoin d'un acteur. Plutôt que d'imposer un argument à des dizaines
 * d'appels existants, l'absence attribue l'acte à `SYSTEME` — les server
 * actions, elles, passent toujours l'utilisateur réel : un acte humain
 * attribué au système serait une preuve fausse.
 */
export async function createClient(
  name: string,
  minutesParJour?: number | null,
  userId?: string,
): Promise<{ id: string; name: string }> {
  const c = await prisma.client.create({ data: { name, minutesParJour: minutesParJour ?? null } })

  await appendAudit({
    ...(await actorOf(userId ?? '')),
    action: 'client.cree',
    entityType: 'Client',
    entityId: c.id,
    payload: { name, minutesParJour: minutesParJour ?? null },
  })

  return { id: c.id, name: c.name }
}

/**
 * Un client est visible pour un utilisateur s'il n'a encore aucune mission,
 * ou a au moins une mission encore sans ligne (client ou mission fraîchement
 * créés, pas encore revendiqués — sinon la création d'un premier client ou
 * d'une première mission serait impossible sur une base vide), ou si
 * l'utilisateur a une affectation sur au moins une ligne d'une de ses
 * missions.
 *
 * Un client **archivé** n'apparaît nulle part : ni dans la liste, ni comme
 * choix à la création d'une mission. Le ranger n'aurait aucun effet s'il
 * continuait de s'offrir au premier formulaire venu.
 */
export async function listClients(userId: string): Promise<Array<{ id: string; name: string }>> {
  return prisma.client.findMany({
    where: {
      archived: false,
      OR: [
        { missions: { none: {} } },
        { missions: { some: { lines: { none: {} } } } },
        { missions: { some: { lines: { some: { assignments: { some: { userId } } } } } } },
      ],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
}
