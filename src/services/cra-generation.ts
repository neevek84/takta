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
import { annulerPrevisionnelDuMois, validerPrevisionnelDuMois } from './cra-previsionnel'
import { getOrCreateCra } from './cra'
import { appendAudit, actorOf } from './audit'
import type { CraStatus } from '@/core/types'

export type ChoixPrevisionnel = 'VALIDER' | 'SUPPRIMER'

export type ResultatGeneration =
  | { ok: true; craId: string; previsionnelTraite: number }
  | { ok: false; raison: 'MOIS_VALIDE'; craId: string }
  | { ok: false; raison: 'NON_AFFECTE' }

function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`)
}

/**
 * Un mois déjà validé, découvert **pendant** la transaction — la fenêtre
 * entre la lecture de garde et l'ouverture de la transaction, où un autre
 * appel aurait validé le mois entre-temps. `getOrCreateCra` ignore ce
 * verrou (il ne connaît pas la notion de « mois clos », propre à la
 * génération) : c'est donc ici, et non dans `cra.ts`, que la course se
 * détecte. Levée pour faire annuler la transaction entière : sans elle, le
 * prévisionnel serait déjà converti ou supprimé au moment où la course se
 * révèle.
 */
class MoisDejaValideError extends Error {
  constructor(readonly craId: string) {
    super('Le CRA de ce mois est déjà validé.')
  }
}

/**
 * Génère le CRA d'un mois, après avoir réglé le sort de son prévisionnel.
 *
 * `lineId` et non `missionId` : c'est ce que l'écran de saisie connaît. La
 * mission est résolue ici, **et l'affectation vérifiée au passage** — le
 * client ne décide pas seul sur quelle mission on écrit.
 */
export async function genererCra(
  userId: string,
  args: { lineId: string; month: string; previsionnel: ChoixPrevisionnel },
): Promise<ResultatGeneration> {
  // La ligne, la mission, et l'affectation — en une lecture scopée.
  const line = await prisma.missionLine.findFirst({
    where: { id: args.lineId, assignments: { some: { userId } } },
    select: { missionId: true },
  })
  if (line === null) return { ok: false, raison: 'NON_AFFECTE' }

  const existant = await prisma.cra.findUnique({
    where: {
      missionId_userId_month: { missionId: line.missionId, userId, month: monthStart(args.month) },
    },
    select: { id: true, status: true },
  })

  // Un mois clos ne se régénère pas : y toucher le prévisionnel contournerait
  // le verrou que toute la saisie respecte. Refusé **avant** toute écriture.
  if (existant !== null && (existant.status as CraStatus) === 'VALIDE') {
    return { ok: false, raison: 'MOIS_VALIDE', craId: existant.id }
  }

  let resultat: { previsionnelTraite: number; craId: string; craCree: boolean }
  try {
    resultat = await prisma.$transaction(async (tx) => {
      const previsionnelTraite =
        args.previsionnel === 'VALIDER'
          ? await validerPrevisionnelDuMois(tx, {
              userId,
              missionId: line.missionId,
              month: args.month,
            })
          : await annulerPrevisionnelDuMois(tx, {
              userId,
              missionId: line.missionId,
              month: args.month,
            })

      const sortie = { cree: false }
      const cra = await getOrCreateCra(userId, line.missionId, args.month, tx, sortie)

      // La lecture de garde, plus haut, a laissé passer un mois qui n'était
      // pas encore validé à cet instant-là. S'il l'est devenu entre cette
      // lecture et l'ouverture de cette transaction — un autre appel a validé
      // pendant que celui-ci traitait son prévisionnel —, mieux vaut annuler
      // tout ce que la transaction a déjà fait, y compris le prévisionnel
      // déjà traité, que de laisser croire qu'on a écrit sur un mois clos.
      if (!sortie.cree && cra.status === 'VALIDE') {
        throw new MoisDejaValideError(cra.id)
      }

      return { previsionnelTraite, craId: cra.id, craCree: sortie.cree }
    })
  } catch (err) {
    if (err instanceof MoisDejaValideError) {
      return { ok: false, raison: 'MOIS_VALIDE', craId: err.craId }
    }
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
      payload: { missionId: line.missionId, month: args.month, status: 'BROUILLON' },
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
        missionId: line.missionId,
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
