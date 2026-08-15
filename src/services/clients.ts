import { prisma } from '@/db/client'

export async function createClient(name: string): Promise<{ id: string; name: string }> {
  const c = await prisma.client.create({ data: { name } })
  return { id: c.id, name: c.name }
}

export async function listClients(): Promise<Array<{ id: string; name: string }>> {
  return prisma.client.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  })
}
