import type { Prisma } from '@prisma/client'
import { trajetsAPoser } from '@/core/saisie/trajets'
import { ENTITY_TRAJET, PROVIDER_GOOGLE } from '@/core/sync/policy'
import { enqueueSync } from './sync/outbox'

/**
 * Calcule, enregistre et met en file les trajets d'une saisie chez le client —
 * **une seule fois dans sa vie**.
 *
 * Appelée dans la transaction d'écriture, après la saisie et sa mise en file :
 * un trajet enregistré sans sa ligne en file ne partirait jamais, et personne
 * ne le saurait. La lecture des autres blocs du jour voit donc aussi ce que la
 * même transaction vient d'écrire.
 *
 * Rien n'est reposé ensuite, même si la saisie change d'heures ou repasse à
 * distance puis sur site : le porteur a pu déplacer ou supprimer le trajet dans
 * son agenda, et le reposer effacerait ce geste. `trajetsCalcules` ne passe à
 * vrai que si un calcul a réellement eu lieu — une durée de trajet nulle laisse
 * la porte ouverte au jour où elle sera réglée.
 */
export async function planifierTrajets(
  tx: Prisma.TransactionClient,
  args: { userId: string; entryId: string; dureeMinutes: number },
): Promise<void> {
  if (args.dureeMinutes <= 0) return

  const saisie = await tx.timeEntry.findFirst({
    where: { id: args.entryId, userId: args.userId },
    include: { line: { include: { mission: { include: { client: true } } } } },
  })
  if (saisie === null || saisie.lieu !== 'SITE' || saisie.trajetsCalcules) return

  const dejaPoses = await tx.trajet.findMany({
    where: { userId: args.userId, date: saisie.date },
    select: { startMinute: true, endMinute: true },
  })
  // Toutes prestations, sur site ou non : un trajet ne mord sur aucun travail.
  const autresBlocs = await tx.timeEntry.findMany({
    where: { userId: args.userId, date: saisie.date, id: { not: saisie.id } },
    select: { startMinute: true, endMinute: true },
  })

  const trajets = trajetsAPoser({
    bloc: { startMinute: saisie.startMinute, endMinute: saisie.endMinute },
    dureeMinutes: args.dureeMinutes,
    dejaPoses,
    autresBlocs,
  })

  for (const t of trajets) {
    const trajet = await tx.trajet.create({
      data: {
        userId: args.userId,
        date: saisie.date,
        startMinute: t.startMinute,
        endMinute: t.endMinute,
        entryId: saisie.id,
        summary: `Trajet · ${saisie.line.mission.client.name}`,
      },
    })
    await enqueueSync(tx, {
      userId: args.userId,
      entityType: ENTITY_TRAJET,
      entityId: trajet.id,
      provider: PROVIDER_GOOGLE,
    })
  }

  await tx.timeEntry.update({ where: { id: saisie.id }, data: { trajetsCalcules: true } })
}
