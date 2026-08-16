import type { Prisma } from '@prisma/client'
import { prisma } from '@/db/client'
import {
  abandon,
  ENTITY_TIME_ENTRY,
  nextAttempt,
  PROVIDER_GOOGLE,
  TAILLE_LOT,
  type SyncOperation,
} from '@/core/sync/policy'
import type { SyncHandler, SyncJob, SyncOutcome } from './types'

/**
 * Au-delà de ce délai, une ligne encore due n'a jamais pu partir : l'agenda
 * n'a jamais été connecté, ou le drainage n'a pas tourné depuis un trimestre.
 */
export const RETENTION_JOURS = 90

/**
 * Borne la file, dans la transaction même qui la fait grossir.
 *
 * La mise en file est inconditionnelle, et c'est voulu : elle est
 * transactionnelle avec l'écriture, et c'est elle qui rend les saisies déjà
 * faites poussables le jour où l'agenda est connecté. Mais sans borne, un
 * utilisateur qui n'active jamais l'agenda accumule une ligne par cellule
 * saisie, que personne ne draine et que rien ne retire.
 *
 * La purge vit ici plutôt que dans le drainage : un compte jamais connecté
 * est précisément celui pour lequel le drainage ne tourne pas.
 *
 * Deux filtres bornent ce qu'elle a le droit de retirer, et aucun des deux
 * n'est décoratif :
 *
 *   - `state: 'PENDING'` — une ligne `FAILED` est le seul témoin d'un échec,
 *     et `abandon()` (`core/sync/policy.ts`) lui donne un `nextAttemptAt` à
 *     l'instant de l'échec : elle vieillit donc comme une autre. L'effacer
 *     viderait l'écran de supervision de ses échecs, exactement ce que le
 *     commentaire d'`abandon()` interdit — « la ligne reste en base ».
 *
 *   - une suppression **dont le lien externe survit** — elle décrit un bloc
 *     qui existe dans l'agenda et qu'il faut en retirer, et sa saisie a déjà
 *     disparu de la base : rien ne remettra jamais cette ligne en file.
 *     L'effacer laisse un bloc fantôme **définitif**, qui occupe une journée
 *     qu'on pourrait revendre — le cas même que la transaction de
 *     `time-entries.ts` existe pour empêcher.
 *
 * Le second filtre porte sur le lien, pas sur l'opération, et c'est ce qui
 * l'empêche de rouvrir la fuite qu'on ferme ici : sans `ExternalLink`, une
 * suppression n'a jamais rien poussé, donc rien à retirer — c'est déjà ce que
 * conclut `traiterSuppression` (`flush.ts`) quand elle en drainerait une. Les
 * garder toutes ferait grossir la file sans borne sur le compte jamais
 * connecté, puisque chaque `clearMonth` frappe des saisies aux `cuid` neufs,
 * donc des lignes neuves.
 *
 * Reste le cas de l'`UPSERT` périmé dont le lien survit : le bloc poussé jadis
 * garde une valeur dépassée. Il part quand même, et c'est assumé — celui-là se
 * répare tout seul à la prochaine retouche de la cellule, qui remet un
 * `UPSERT` en file. C'est la seule des trois situations qui soit rattrapable.
 */
async function purgerLignesPerimees(
  tx: Prisma.TransactionClient,
  args: { userId: string; provider: string; now: Date },
): Promise<void> {
  const perimees = await tx.syncOutbox.findMany({
    where: {
      userId: args.userId,
      provider: args.provider,
      state: 'PENDING',
      nextAttemptAt: { lt: new Date(args.now.getTime() - RETENTION_JOURS * 86_400_000) },
    },
    select: { id: true, entityType: true, entityId: true, operation: true },
  })
  if (perimees.length === 0) return

  const suppressions = perimees.filter((l) => l.operation === 'DELETE')
  const retirables = perimees.filter((l) => l.operation !== 'DELETE').map((l) => l.id)

  // Second aller-retour seulement s'il y a une suppression à trancher : le cas
  // courant — un compte jamais connecté qui accumule des `UPSERT` — n'en
  // paie pas le coût.
  if (suppressions.length > 0) {
    const liens = await tx.externalLink.findMany({
      // Scopé sur `userId`, comme toute requête de service — ce que le
      // rattachement posé sur `ExternalLink` rend enfin possible.
      where: {
        userId: args.userId,
        provider: args.provider,
        entityId: { in: suppressions.map((l) => l.entityId) },
      },
      select: { entityType: true, entityId: true },
    })
    const lies = new Set(liens.map((l) => `${l.entityType}/${l.entityId}`))
    for (const l of suppressions) {
      if (!lies.has(`${l.entityType}/${l.entityId}`)) retirables.push(l.id)
    }
  }

  if (retirables.length === 0) return
  await tx.syncOutbox.deleteMany({ where: { id: { in: retirables } } })
}

/**
 * Inscrit une entité dans la file — **toujours dans la transaction d'écriture**.
 *
 * L'upsert sur le triplet est ce qui fait de la file un ensemble : dix
 * modifications d'une même cellule avant le prochain passage produisent une
 * ligne, pas dix. Chaque réécriture repart d'un compteur neuf : une nouvelle
 * intention mérite un nouveau quota de tentatives, et une ligne tombée en
 * `FAILED` redevient éligible dès que l'utilisateur retouche la cellule.
 */
export async function enqueueSync(
  tx: Prisma.TransactionClient,
  args: {
    userId: string
    entityType: string
    entityId: string
    provider: string
    operation?: SyncOperation
    /**
     * Contexte de rejeu, transmis tel quel au gestionnaire. Facultatif, et
     * vide pour l'agenda : sa cible est une saisie, que le drainage relit en
     * base. Un fournisseur dont la cible a changé de forme entre-temps y
     * dépose ce qu'il lui faudra.
     */
    payload?: Record<string, string>
    now?: Date
  },
): Promise<void> {
  const now = args.now ?? new Date()
  const operation = args.operation ?? 'UPSERT'
  const payloadJson = JSON.stringify(args.payload ?? {})
  const cible = {
    entityType: args.entityType,
    entityId: args.entityId,
    provider: args.provider,
  }

  await purgerLignesPerimees(tx, { userId: args.userId, provider: args.provider, now })

  await tx.syncOutbox.upsert({
    where: { entityType_entityId_provider: cible },
    create: {
      ...cible,
      userId: args.userId,
      operation,
      payloadJson,
      state: 'PENDING',
      attempts: 0,
      lastError: '',
      nextAttemptAt: now,
    },
    update: {
      operation,
      payloadJson,
      state: 'PENDING',
      attempts: 0,
      lastError: '',
      nextAttemptAt: now,
    },
  })
}

export interface OutboxFlushReport {
  traitees: number
  reussies: number
  /** échecs rejouables : la ligne reste en file avec un nouveau rendez-vous */
  replanifiees: number
  /** lignes passées en `FAILED` : elles restent en base, visibles à l'écran */
  echouees: number
}

/** Le message d'échec n'est pas un journal d'exécution : il tient dans la colonne. */
function borner(message: string): string {
  return message.slice(0, 500)
}

function relirePayload(brut: string): Record<string, string> {
  try {
    const parse: unknown = JSON.parse(brut)
    if (parse === null || typeof parse !== 'object' || Array.isArray(parse)) return {}
    return parse as Record<string, string>
  } catch {
    // Un contexte illisible ne condamne pas la ligne : la cible, elle, reste
    // parfaitement poussable. Lever ici ferait échouer cinq fois une
    // synchronisation que rien n'empêchait d'aboutir.
    return {}
  }
}

/**
 * Draine la file d'un compte pour les fournisseurs dont on tient un
 * gestionnaire.
 *
 * **Ce que ce drainage-ci ne suppose pas.** Il ne connaît ni Google ni
 * Dolibarr, ne construit aucune requête distante et ne sait pas si la clé du
 * fournisseur appartient à une personne ou à l'instance : il lit des lignes,
 * appelle un gestionnaire, et applique la politique de reprise du noyau. C'est
 * ce qui permet à un fournisseur d'instance de consommer la même file qu'un
 * fournisseur personnel.
 *
 * **Ce qu'il suppose, en revanche, et qui est délibéré.** La ligne, elle, est
 * personnelle : `userId` est obligatoire et scope la lecture, comme toute
 * fonction de service de ce projet. Le fournisseur peut être commun à tous ;
 * le CRA qu'on pousse ne l'est jamais.
 *
 * **Un fournisseur sans gestionnaire n'est pas un fournisseur en panne.** Ses
 * lignes ne sont même pas lues : elles attendent en `PENDING` que la clé
 * d'API soit saisie. Les marquer en échec viderait leur quota de tentatives
 * avant que le connecteur ait jamais existé, et il faudrait ensuite les
 * réarmer une par une à la main.
 */
export async function flushOutbox(args: {
  userId: string
  handlers: Record<string, SyncHandler>
  limit?: number
  now?: Date
}): Promise<OutboxFlushReport> {
  const now = args.now ?? new Date()
  const rapport: OutboxFlushReport = { traitees: 0, reussies: 0, replanifiees: 0, echouees: 0 }

  const providers = Object.keys(args.handlers)
  if (providers.length === 0) return rapport

  // `nextAttemptAt` porte un recul après échec, pas une date d'ouverture : une
  // ligne jamais tentée est due quelle que soit l'horloge de l'appelant. Même
  // lecture que le drainage de l'agenda, pour la même raison — comparer une
  // estampille posée par l'horloge système à un instant injecté rendrait la
  // file inerte sans que rien ne le signale.
  const lignes = await prisma.syncOutbox.findMany({
    where: {
      userId: args.userId,
      provider: { in: providers },
      state: 'PENDING',
      OR: [{ attempts: 0 }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: args.limit ?? TAILLE_LOT,
  })

  for (const ligne of lignes) {
    const handler = args.handlers[ligne.provider]
    if (handler === undefined) continue

    const job: SyncJob = {
      id: ligne.id,
      userId: ligne.userId,
      entityType: ligne.entityType,
      entityId: ligne.entityId,
      provider: ligne.provider,
      operation: ligne.operation as SyncOperation,
      attempts: ligne.attempts,
      payload: relirePayload(ligne.payloadJson),
    }

    rapport.traitees += 1

    // Une exception non prévue ne doit interrompre ni le drainage des autres
    // lignes ni le quota de celle-ci : elle vaut échec rejouable.
    let resultat: SyncOutcome
    try {
      resultat = job.operation === 'DELETE' ? await handler.remove(job) : await handler.upsert(job)
    } catch (err) {
      resultat = {
        ok: false,
        retriable: true,
        message: err instanceof Error ? err.message : String(err),
      }
    }

    if (resultat.ok) {
      await prisma.syncOutbox.delete({ where: { id: ligne.id } })
      rapport.reussies += 1
      continue
    }

    // La politique de reprise vient du noyau, pas d'ici : le recul progressif
    // et le quota sont les mêmes pour tous les fournisseurs, et les dupliquer
    // les ferait diverger en silence.
    const suite = resultat.retriable
      ? nextAttempt(ligne.attempts, now)
      : abandon(ligne.attempts, now)

    await prisma.syncOutbox.update({
      where: { id: ligne.id },
      data: {
        attempts: suite.attempts,
        state: suite.state,
        nextAttemptAt: suite.nextAttemptAt,
        lastError: borner(resultat.message),
      },
    })

    if (suite.state === 'FAILED') rapport.echouees += 1
    else rapport.replanifiees += 1
  }

  return rapport
}

/** La cible unique du lot 1b : une ligne de temps vers Google. */
export async function enqueueTimeEntry(
  tx: Prisma.TransactionClient,
  args: { userId: string; entryId: string; operation: SyncOperation; now?: Date },
): Promise<void> {
  await enqueueSync(tx, {
    userId: args.userId,
    entityType: ENTITY_TIME_ENTRY,
    entityId: args.entryId,
    provider: PROVIDER_GOOGLE,
    operation: args.operation,
    ...(args.now === undefined ? {} : { now: args.now }),
  })
}
