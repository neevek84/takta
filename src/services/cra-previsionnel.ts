/**
 * Le sort du prévisionnel d'un mois que le client vient de valider.
 *
 * **Le problème, et il ne se voit pas.** Un CRA validé verrouille son mois :
 * plus aucune saisie ne s'y modifie. Les jours **prévisionnels** de ce mois-là
 * restent alors figés pour toujours — ni réalisés, ni annulables. Or
 * l'engagement les compte comme consommés : le reste à consommer de la mission
 * en est diminué à jamais, et personne ne le remarque, parce que le CRA
 * imprimé, lui, ne montre que le réalisé du mois.
 *
 * Un jour prévu qui n'a pas eu lieu au moment où le mois se ferme n'aura plus
 * lieu. Il est donc **annulé** à la validation, et non conservé.
 *
 * Ce qui est annulé ne l'est jamais en silence : le compte entre au journal
 * d'audit, et l'écran des CRA l'annonce **avant** la validation, pas après.
 */
import { prisma } from '@/db/client'
import { enqueueTimeEntry } from '@/services/sync/outbox'
import type { Prisma } from '@prisma/client'

/** Le premier instant du mois, en UTC. `month` est au format 'YYYY-MM'. */
function bornes(month: string): { debut: Date; fin: Date } {
  const [annee, mois] = month.split('-').map(Number) as [number, number]
  return {
    debut: new Date(Date.UTC(annee, mois - 1, 1)),
    fin: new Date(Date.UTC(annee, mois, 1)),
  }
}

/**
 * Combien de jours prévisionnels chaque mission porte sur ce mois, pour cet
 * utilisateur.
 *
 * Rendu par mission et en une seule requête : l'écran en affiche autant que de
 * CRA, et une requête par ligne ferait payer la liste au nombre de missions.
 */
export async function compterPrevisionnelParMission(args: {
  userId: string
  missionIds: ReadonlyArray<string>
  /** 'YYYY-MM' */
  month: string
}): Promise<Map<string, number>> {
  if (args.missionIds.length === 0) return new Map()
  const { debut, fin } = bornes(args.month)

  const saisies = await prisma.timeEntry.findMany({
    where: {
      userId: args.userId,
      kind: 'PREVISIONNEL',
      date: { gte: debut, lt: fin },
      line: { missionId: { in: [...args.missionIds] } },
    },
    select: { line: { select: { missionId: true } } },
  })

  const par = new Map<string, number>()
  for (const s of saisies) {
    par.set(s.line.missionId, (par.get(s.line.missionId) ?? 0) + 1)
  }
  return par
}

/**
 * Annule le prévisionnel du mois d'une mission, et rend le nombre de saisies
 * emportées.
 *
 * Prend la transaction en paramètre : l'annulation et le changement d'état du
 * CRA doivent tomber ensemble. Un mois validé dont le prévisionnel survit à un
 * échec d'écriture serait exactement le défaut qu'on ferme.
 *
 * Chaque suppression entre en file de synchronisation : sans cela, le bloc
 * d'agenda du jour prévu resterait dans Google pour l'éternité, sur un jour
 * qui n'aura pas lieu.
 */
export async function annulerPrevisionnelDuMois(
  tx: Prisma.TransactionClient,
  args: { userId: string; missionId: string; month: string },
): Promise<number> {
  const { debut, fin } = bornes(args.month)

  // Les identifiants sont relevés **avant** la suppression : c'est la seule
  // façon de mettre en file la disparition de leurs blocs d'agenda.
  const emportees = await tx.timeEntry.findMany({
    where: {
      userId: args.userId,
      kind: 'PREVISIONNEL',
      date: { gte: debut, lt: fin },
      line: { missionId: args.missionId },
    },
    select: { id: true },
  })
  if (emportees.length === 0) return 0

  await tx.timeEntry.deleteMany({
    where: { userId: args.userId, id: { in: emportees.map((e) => e.id) } },
  })
  for (const emportee of emportees) {
    await enqueueTimeEntry(tx, { userId: args.userId, entryId: emportee.id, operation: 'DELETE' })
  }

  return emportees.length
}

/**
 * Passe en réalisé le prévisionnel du mois d'une mission, et rend le nombre de
 * saisies converties.
 *
 * **Le miroir exact d'`annulerPrevisionnelDuMois`**, et volontairement son
 * voisin de fichier : ce sont les deux issues d'une même question posée à
 * l'utilisateur au moment où il génère un CRA. Les séparer les ferait diverger.
 *
 * **Ce n'est pas `convertPastForecast`.** Celle-ci ne prend que le
 * prévisionnel *échu* et n'est pas scopée sur une mission : s'en servir ici
 * convertirait le prévisionnel des autres clients et laisserait de côté
 * précisément les jours à venir qu'on veut projeter.
 *
 * Elle ne consulte pas le verrou de CRA validé : le cas est refusé en amont,
 * par `genererCra`, avant qu'aucune saisie ne soit touchée.
 *
 * Chaque saisie repart en file `UPSERT` : le prévisionnel converti change de
 * couleur dans l'agenda.
 */
export async function validerPrevisionnelDuMois(
  tx: Prisma.TransactionClient,
  args: { userId: string; missionId: string; month: string },
): Promise<number> {
  const { debut, fin } = bornes(args.month)

  const converties = await tx.timeEntry.findMany({
    where: {
      userId: args.userId,
      kind: 'PREVISIONNEL',
      date: { gte: debut, lt: fin },
      line: { missionId: args.missionId },
    },
    select: { id: true },
  })
  if (converties.length === 0) return 0

  await tx.timeEntry.updateMany({
    where: { userId: args.userId, id: { in: converties.map((e) => e.id) } },
    data: { kind: 'REALISE' },
  })
  for (const convertie of converties) {
    await enqueueTimeEntry(tx, { userId: args.userId, entryId: convertie.id, operation: 'UPSERT' })
  }

  return converties.length
}
