import type { Prisma } from '@prisma/client'
import { ENTITY_TIME_ENTRY, PROVIDER_GOOGLE, type SyncOperation } from '@/core/sync/policy'

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
    operation: SyncOperation
    now?: Date
  },
): Promise<void> {
  const now = args.now ?? new Date()
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
      operation: args.operation,
      state: 'PENDING',
      attempts: 0,
      lastError: '',
      nextAttemptAt: now,
    },
    update: {
      operation: args.operation,
      state: 'PENDING',
      attempts: 0,
      lastError: '',
      nextAttemptAt: now,
    },
  })
}

/** La cible unique du lot : une ligne de temps vers Google. */
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
