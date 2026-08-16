import { PrismaClient } from '@prisma/client'

// Reprise des heures d'une saisie — le pendant, côté SQLite, de ce que la
// migration Postgres `20260820000000_time_entry_hours` fait en SQL.
//
// `npm run db:sqlite` passe par `prisma db push`, qui n'exécute aucune
// migration : une base locale peuplée reçoit les colonnes avec leur valeur par
// défaut, et rien d'autre. Ce script leur donne les vraies bornes.
//
// La règle est celle de `entryBounds` (src/core/time/slots.ts), recopiée ici
// parce qu'un script ESM ne peut pas importer du TypeScript sans outillage :
// une saisie portant un créneau nommé reçoit **ses bornes actuelles** ; une
// saisie à la journée reçoit celles de la journée de travail, tronquées au
// temps réellement saisi pour ne pas occuper une soirée que personne n'a
// vendue.
//
// Idempotent : relancé, il réécrit les mêmes valeurs. À ne PAS relancer après
// qu'un créneau a été redéfini en administration — il déplacerait alors les
// saisies que le gel protège. C'est un script de reprise, pas d'entretien.

const prisma = new PrismaClient()

const settings = await prisma.settings.findUnique({ where: { id: 'singleton' } })
const journeeDebut = settings?.journeeDebutMinute ?? 540
const journeeFin = settings?.journeeFinMinute ?? 1080
const slots = JSON.parse(settings?.slotsJson ?? '[]')

const entries = await prisma.timeEntry.findMany({
  select: { id: true, slotId: true, minutes: true },
})

let repris = 0
for (const e of entries) {
  const slot = slots.find((s) => s.id === e.slotId)

  const bornes =
    slot === undefined
      ? {
          startMinute: journeeDebut,
          endMinute:
            (journeeDebut + Math.min(e.minutes, Math.max(0, journeeFin - journeeDebut))) % 1440,
        }
      : { startMinute: slot.startMinute, endMinute: slot.endMinute }

  await prisma.timeEntry.update({ where: { id: e.id }, data: bornes })
  repris++
}

console.log(`${repris} saisie(s) reprise(s).`)
await prisma.$disconnect()
