import { prisma } from '@/db/client'
import { enqueueTimeEntry } from './outbox'

export interface RenvoiResult {
  ok: boolean
  /** nombre de saisies remises en file ; 0 quand le refus l'emporte */
  misesEnFile: number
  /** vide quand tout va bien */
  motif: string
}

/**
 * Au-delà, on n'aide plus : on inonde. Un an de saisies représente déjà
 * plusieurs centaines de blocs à écrire chez Google, un par un.
 */
export const DUREE_MAXIMALE_JOURS = 400

/**
 * Remet en file, vers l'agenda, les saisies d'une période.
 *
 * **Ce qu'il répare.** Deux chemins ont écrit des saisies sans jamais les
 * mettre en file : la reprise Dolibarr — corrigée depuis, mais l'historique
 * déjà repris reste muet — et toute saisie antérieure à la connexion de
 * l'agenda, dont la ligne de file a pu être purgée avant qu'un connecteur
 * n'existe. Résultat vu par le porteur : seuls les prévisionnels tapés à la
 * main apparaissaient dans son agenda.
 *
 * **Idempotent.** La file est une table à cible unique : remettre une saisie
 * déjà en file la remplace au lieu de la doubler. Et une saisie déjà poussée
 * porte sa correspondance : le drainage mettra le bloc à jour au lieu d'en
 * créer un second.
 *
 * **La période est bornée et explicite**, jamais « tout ». Un rattrapage qui
 * partirait sur toute l'histoire d'une installation enverrait des milliers
 * d'écritures chez un tiers sans que personne ne l'ait voulu.
 *
 * Les CRA validés **ne sont pas exclus** : c'est précisément l'historique que
 * la reprise a marqué validé, et c'est lui qu'on veut voir dans l'agenda. Le
 * gel d'un CRA porte sur la saisie, pas sur le fait de la donner à lire.
 */
export async function renvoyerVersAgenda(args: {
  userId: string
  /** premier jour inclus, `YYYY-MM-DD` */
  du: string
  /** dernier jour inclus, `YYYY-MM-DD` */
  au: string
}): Promise<RenvoiResult> {
  const refus = (motif: string): RenvoiResult => ({ ok: false, misesEnFile: 0, motif })

  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.du) || !/^\d{4}-\d{2}-\d{2}$/.test(args.au)) {
    return refus('Indiquez deux dates, au format JJ/MM/AAAA.')
  }
  const debut = new Date(`${args.du}T00:00:00.000Z`)
  const fin = new Date(`${args.au}T00:00:00.000Z`)
  if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) {
    return refus('Indiquez deux dates valides.')
  }
  // Inversées, elles ne rendraient rien — et « 0 saisie » se lit comme « il
  // n'y avait rien », pas comme « vos dates sont à l'envers ».
  if (fin < debut) return refus('La date de fin précède la date de début.')

  const jours = (fin.getTime() - debut.getTime()) / 86_400_000
  if (jours > DUREE_MAXIMALE_JOURS) {
    return refus(
      `Période trop longue : ${DUREE_MAXIMALE_JOURS} jours au maximum, ` +
        'pour ne pas inonder l’agenda d’un seul geste.',
    )
  }

  const saisies = await prisma.timeEntry.findMany({
    where: { userId: args.userId, date: { gte: debut, lte: fin } },
    select: { id: true },
    orderBy: { date: 'asc' },
  })

  for (const saisie of saisies) {
    await prisma.$transaction(async (tx) => {
      await enqueueTimeEntry(tx, {
        userId: args.userId,
        entryId: saisie.id,
        operation: 'UPSERT',
      })
    })
  }

  return { ok: true, misesEnFile: saisies.length, motif: '' }
}
