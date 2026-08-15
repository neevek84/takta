import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
const global = settings?.minutesParJour ?? 480

const entries = await prisma.timeEntry.findMany({
  select: {
    id: true,
    line: {
      select: {
        minutesParJour: true,
        mission: { select: { minutesParJour: true, client: { select: { minutesParJour: true } } } },
      },
    },
  },
})

let repris = 0
for (const e of entries) {
  const effectif =
    e.line.minutesParJour ??
    e.line.mission.minutesParJour ??
    e.line.mission.client.minutesParJour ??
    global

  await prisma.timeEntry.update({ where: { id: e.id }, data: { minutesParJour: effectif } })
  repris++
}

console.log(`${repris} saisie(s) reprise(s).`)
await prisma.$disconnect()
