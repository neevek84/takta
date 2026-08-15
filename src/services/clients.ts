import { prisma } from '@/db/client'

export async function createClient(name: string): Promise<{ id: string; name: string }> {
  const c = await prisma.client.create({ data: { name } })
  return { id: c.id, name: c.name }
}

/**
 * Un client est visible pour un utilisateur s'il n'a encore aucune mission,
 * ou a au moins une mission encore sans ligne (client ou mission fraîchement
 * créés, pas encore revendiqués — sinon la création d'un premier client ou
 * d'une première mission serait impossible sur une base vide), ou si
 * l'utilisateur a une affectation sur au moins une ligne d'une de ses
 * missions.
 */
export async function listClients(userId: string): Promise<Array<{ id: string; name: string }>> {
  return prisma.client.findMany({
    where: {
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
