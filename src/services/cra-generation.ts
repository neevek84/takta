/**
 * Génère (ou rend) le CRA d'un mois, après avoir réglé le sort de son
 * prévisionnel.
 *
 * **Pourquoi ce service existe.** Un client qui demande le CRA le 20 du mois
 * veut voir les jours 21 à 31 : ils sont déjà saisis en PREVISIONNEL — connus,
 * engagés — et n'apparaissent pourtant pas sur le document tel qu'il existe
 * aujourd'hui. Pire : valider ce CRA les efface en silence
 * (`cra-previsionnel.ts`, `services/cra.ts`). Le porteur a tranché : « ça ne
 * doit pas disparaître, mais ça doit être un choix humain et pas auto ».
 * Générer un CRA pose donc la question, et les deux réponses sont les deux
 * fonctions que ce service appelle.
 *
 * **Les deux tombent ensemble, dans une seule transaction.** Un prévisionnel
 * supprimé sans CRA créé est une perte de données que rien ne rattrape ; un
 * CRA créé sur un prévisionnel non traité ment sur ce qu'il porte.
 * `getOrCreateCra` (`@/services/cra`) accepte pour cela une transaction en
 * paramètre — la nôtre, ici, plutôt que sa propre écriture par défaut — afin
 * que la création du CRA et le traitement du prévisionnel tombent ou tiennent
 * ensemble. Sa propre capture de course (conflit d'unicité → relecture) et sa
 * propre discipline d'écriture du journal sont réutilisées telles quelles :
 * une seconde implémentation aurait divergé de la première au premier défaut
 * corrigé d'un seul côté.
 */
import { prisma } from '@/db/client'
import type { Prisma } from '@prisma/client'
import { annulerPrevisionnelDuMois, validerPrevisionnelDuMois } from './cra-previsionnel'
import { getOrCreateCra } from './cra'
import { appendAudit, actorOf } from './audit'
import type { CraStatus } from '@/core/types'
import { isLocked } from '@/core/cra/state-machine'
import { perimetreDuCra, TOUTE_LA_MISSION } from '@/core/cra/perimetre'
import type { PerimetreCra } from './cra-perimetre'

export type ChoixPrevisionnel = 'VALIDER' | 'SUPPRIMER'

export type ResultatGeneration =
  | { ok: true; craId: string; previsionnelTraite: number }
  /**
   * Le mois est fermé à la saisie (`isLocked`) : validé, ou envoyé au client
   * et en attente de sa réponse. `statut` dit lequel, pour que l'écran nomme
   * le bon geste de sortie (rouvrir, ou annuler l'envoi).
   */
  | { ok: false; raison: 'MOIS_FERME'; craId: string; statut: CraStatus }
  /**
   * Un CRA de l'**autre** forme couvre déjà ces jours, et il a vécu : envoyé,
   * validé, refusé, ou porteur d'un envoi passé. C'est le cas d'une mission
   * qui a changé de réglage en cours de route. Générer ici ferait figurer les
   * mêmes jours sur deux CRA — donc sur deux factures. `prestationLabel` nomme
   * ce CRA : `null` pour celui de toute la mission.
   */
  | {
      ok: false
      raison: 'AUTRE_PERIMETRE'
      craId: string
      statut: CraStatus
      prestationLabel: string | null
    }
  | { ok: false; raison: 'NON_AFFECTE' }

function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`)
}

/**
 * Un mois fermé (validé ou envoyé), découvert **pendant** la transaction — la
 * fenêtre entre la lecture de garde et l'ouverture de la transaction, où un
 * autre appel aurait validé ou envoyé le mois entre-temps. `getOrCreateCra` ignore ce
 * verrou (il ne connaît pas la notion de « mois clos », propre à la
 * génération) : c'est donc ici, et non dans `cra.ts`, que la course se
 * détecte. Levée pour faire annuler la transaction entière : sans elle, le
 * prévisionnel serait déjà converti ou supprimé au moment où la course se
 * révèle.
 */
class MoisDejaValideError extends Error {
  constructor(
    readonly craId: string,
    readonly statut: CraStatus,
  ) {
    super('Le CRA de ce mois est fermé à la saisie.')
  }
}

/**
 * Un CRA de l'autre forme qui a vécu, découvert **pendant** la transaction :
 * levée pour l'annuler entière, comme `MoisDejaValideError`.
 */
class ChevauchementError extends Error {
  constructor(readonly resultat: ResultatGeneration & { raison: 'AUTRE_PERIMETRE' }) {
    super('Un autre CRA couvre déjà ces jours.')
  }
}

/**
 * Le premier CRA de l'autre forme, sur ce mois, qui a **vécu** — tout sauf un
 * brouillon jamais envoyé — rendu comme refus ; `null` s'il n'y en a pas.
 */
async function crasChevauchantsVecus(
  client: Prisma.TransactionClient | typeof prisma,
  userId: string,
  perimetre: PerimetreCra,
  month: string,
): Promise<(ResultatGeneration & { raison: 'AUTRE_PERIMETRE' }) | null> {
  const autres = await client.cra.findMany({
    where: {
      missionId: perimetre.missionId,
      userId,
      month: monthStart(month),
      ...chevauchants(perimetre),
    },
    select: {
      id: true,
      lineId: true,
      status: true,
      signatureRequest: { select: { id: true } },
      _count: { select: { envoisClos: true } },
      mission: { select: { lines: { select: { id: true, label: true } } } },
    },
    orderBy: { lineId: 'asc' },
  })
  const vecu = autres.find(
    (c) => c.status !== 'BROUILLON' || c.signatureRequest !== null || c._count.envoisClos > 0,
  )
  if (vecu === undefined) return null
  return {
    ok: false,
    raison: 'AUTRE_PERIMETRE',
    craId: vecu.id,
    statut: vecu.status as CraStatus,
    prestationLabel:
      vecu.lineId === TOUTE_LA_MISSION
        ? null
        : (vecu.mission.lines.find((l) => l.id === vecu.lineId)?.label ?? vecu.lineId),
  }
}

/**
 * Ce que couvrira le CRA généré depuis cette prestation : toute sa mission, ou
 * elle seule, selon le réglage de la mission (`Mission.modeCra`) — et, au
 * passage, la preuve que l'utilisateur y est affecté, en une lecture scopée.
 *
 * Partagée entre `genererCra` et `compterPrevisionnelDeLaLigne` (l'action de
 * la Saisie qui lit le nombre de jours avant de poser la question) : les deux
 * ont besoin de la même garantie — le client ne décide pas seul sur quelle
 * mission on lit ou on écrit — et du même périmètre, faute de quoi la question
 * porterait sur d'autres jours que ceux que la génération touche.
 */
export async function resoudrePerimetreAffecte(
  userId: string,
  lineId: string,
): Promise<PerimetreCra | null> {
  const line = await prisma.missionLine.findFirst({
    where: { id: lineId, assignments: { some: { userId } } },
    select: { missionId: true, mission: { select: { modeCra: true } } },
  })
  if (line === null) return null
  return { missionId: line.missionId, lineId: perimetreDuCra(line.mission.modeCra, lineId) }
}

/**
 * Les CRA de l'autre forme qui couvrent une partie des mêmes jours : pour un
 * CRA de prestation, celui de toute la mission ; pour un CRA de mission, ceux
 * de chacune de ses prestations.
 */
function chevauchants(p: PerimetreCra): { lineId: string } | { NOT: { lineId: string } } {
  return p.lineId === TOUTE_LA_MISSION
    ? { NOT: { lineId: TOUTE_LA_MISSION } }
    : { lineId: TOUTE_LA_MISSION }
}

/**
 * Génère le CRA d'un mois, après avoir réglé le sort de son prévisionnel.
 *
 * `lineId` et non `missionId` : c'est ce que l'écran de saisie connaît. La
 * mission est résolue ici, **et l'affectation vérifiée au passage** — le
 * client ne décide pas seul sur quelle mission on écrit. Le réglage de la
 * mission dit ensuite si le CRA couvre toute la mission ou cette seule
 * prestation (`@/core/cra/perimetre`).
 *
 * **Jamais deux CRA sur les mêmes jours.** Quand la mission a changé de
 * réglage, un CRA de l'autre forme peut exister sur ce mois. S'il n'a jamais
 * vécu — brouillon, sans envoi passé —, il n'est qu'une coquille : les jours
 * vivent dans les saisies, pas dans le CRA. Il est retiré dans la même
 * transaction, et celui-ci le remplace. S'il a vécu, la génération est
 * refusée (`AUTRE_PERIMETRE`) : il reste celui de référence pour ce mois.
 */
export async function genererCra(
  userId: string,
  args: { lineId: string; month: string; previsionnel: ChoixPrevisionnel },
): Promise<ResultatGeneration> {
  const perimetre = await resoudrePerimetreAffecte(userId, args.lineId)
  if (perimetre === null) return { ok: false, raison: 'NON_AFFECTE' }
  const { missionId, lineId } = perimetre

  const existant = await prisma.cra.findUnique({
    where: {
      missionId_userId_month_lineId: { missionId, userId, month: monthStart(args.month), lineId },
    },
    select: { id: true, status: true },
  })

  // Un mois fermé ne se régénère pas : y toucher le prévisionnel contournerait
  // le verrou que toute la saisie respecte. `isLocked` et non `=== 'VALIDE'` :
  // depuis le lot 3b, un mois ENVOYE est fermé lui aussi — convertir ses jours
  // prévus changerait le document que le client est en train de relire.
  // Refusé **avant** toute écriture.
  if (existant !== null && isLocked(existant.status as CraStatus)) {
    return {
      ok: false,
      raison: 'MOIS_FERME',
      craId: existant.id,
      statut: existant.status as CraStatus,
    }
  }

  // Lu hors transaction pour refuser tôt et sans rien écrire ; la transaction
  // le relit avant de supprimer quoi que ce soit.
  const vecu = await crasChevauchantsVecus(prisma, userId, perimetre, args.month)
  if (vecu !== null) return vecu

  let resultat: { previsionnelTraite: number; craId: string; craCree: boolean }
  try {
    resultat = await prisma.$transaction(async (tx) => {
      const course = await crasChevauchantsVecus(tx, userId, perimetre, args.month)
      if (course !== null) throw new ChevauchementError(course)

      // Les coquilles de l'autre forme : brouillons sans envoi passé. Elles ne
      // portent rien que les saisies ne portent déjà.
      await tx.cra.deleteMany({
        where: {
          missionId,
          userId,
          month: monthStart(args.month),
          ...chevauchants(perimetre),
        },
      })

      const previsionnelTraite =
        args.previsionnel === 'VALIDER'
          ? await validerPrevisionnelDuMois(tx, {
              userId,
              missionId,
              lineId,
              month: args.month,
            })
          : await annulerPrevisionnelDuMois(tx, {
              userId,
              missionId,
              lineId,
              month: args.month,
            })

      const sortie = { cree: false }
      const cra = await getOrCreateCra(userId, missionId, args.month, tx, sortie, lineId)

      // La lecture de garde, plus haut, a laissé passer un mois qui n'était
      // pas encore validé à cet instant-là. S'il l'est devenu entre cette
      // lecture et l'ouverture de cette transaction — un autre appel a validé
      // pendant que celui-ci traitait son prévisionnel —, mieux vaut annuler
      // tout ce que la transaction a déjà fait, y compris le prévisionnel
      // déjà traité, que de laisser croire qu'on a écrit sur un mois clos.
      if (!sortie.cree && isLocked(cra.status as CraStatus)) {
        throw new MoisDejaValideError(cra.id, cra.status as CraStatus)
      }

      return { previsionnelTraite, craId: cra.id, craCree: sortie.cree }
    })
  } catch (err) {
    if (err instanceof MoisDejaValideError) {
      return { ok: false, raison: 'MOIS_FERME', craId: err.craId, statut: err.statut }
    }
    if (err instanceof ChevauchementError) return err.resultat
    throw err
  }
  const { previsionnelTraite, craId, craCree } = resultat

  // Consigné après la transaction : le journal atteste de ce qui a eu lieu,
  // et une transaction annulée n'a rien fait avoir lieu. `getOrCreateCra`
  // n'a rien consigné lui-même pour cette création — voir son commentaire
  // dans `cra.ts` — c'est donc à faire ici.
  if (craCree) {
    await appendAudit({
      ...(await actorOf(userId)),
      action: 'cra.ouvert',
      entityType: 'Cra',
      entityId: craId,
      payload: {
        missionId,
        month: args.month,
        status: 'BROUILLON',
        ...(lineId === TOUTE_LA_MISSION ? {} : { lineId }),
      },
    })
  }

  // Zéro jour traité ne se consigne pas : il n'y a pas eu d'acte, et un mois
  // qui ne portait aucun prévisionnel n'a rien à en dire.
  if (previsionnelTraite > 0) {
    await appendAudit({
      ...(await actorOf(userId)),
      action: args.previsionnel === 'VALIDER' ? 'previsionnel.converti' : 'previsionnel.supprime',
      entityType: 'Mois',
      entityId: args.month,
      payload: {
        month: args.month,
        missionId,
        ...(lineId === TOUTE_LA_MISSION ? {} : { lineId }),
        // D'où vient le geste : ce n'est pas l'annulation automatique portée
        // par `cra-previsionnel.ts` à la validation, c'est la question posée
        // à la génération du CRA.
        origine: 'generation-cra',
        ...(args.previsionnel === 'VALIDER'
          ? { converted: previsionnelTraite }
          : { supprimes: previsionnelTraite }),
      },
    })
  }

  return { ok: true, craId, previsionnelTraite }
}
