import { TAILLE_LOT } from '@/core/sync/policy'
import type { FetchLike } from '@/integrations/google/calendar'
import { drainSyncOutbox, flushAllSyncOutboxes, type DrainReport } from './flush'
import { buildSyncHandlers } from './handlers'
import { drainOutbox, listPendingOutboxUsers } from './outbox'

/**
 * Le déclenchement, **tous fournisseurs confondus**.
 *
 * Deux drainages coexistent dans ce projet, et ce module est le seul endroit
 * qui les appelle tous les deux :
 *
 *   - l'agenda, par connecteur (`flush.ts`) : un jeton OAuth par personne, une
 *     lecture avant écriture, des divergences à arbitrer ;
 *   - le reste, par gestionnaires (`outbox.ts` + `handlers.ts`) : une clé
 *     d'API d'instance, un verdict par ligne, aucune divergence.
 *
 * La frontière est nette et le reste : rien ici ne fait passer une ligne d'un
 * drainage à l'autre. Les fusionner ferait pousser des lignes Dolibarr par le
 * connecteur d'agenda — le défaut exact qui, avant le filtre par fournisseur,
 * supprimait silencieusement chaque CRA validé.
 */

/**
 * Ce que le bouton « Synchroniser maintenant » déclenche, pour le seul compte
 * de la session.
 *
 * Le compte rendu est cumulé sur les deux drainages : deux bandeaux séparés
 * laisseraient croire qu'un « 0 traité » côté agenda vaut « rien n'est parti »,
 * alors qu'un CRA vient de partir chez Dolibarr.
 */
export async function drainProvidersForUser(args: {
  userId: string
  limit?: number
  now?: Date
  /** borne de sécurité, injectée par les tests */
  maxPasses?: number
  /** injecté par les tests ; la production n'en passe aucun */
  fetchFn?: FetchLike
}): Promise<DrainReport> {
  const passeArgs = {
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.now === undefined ? {} : { now: args.now }),
    ...(args.maxPasses === undefined ? {} : { maxPasses: args.maxPasses }),
  }

  const agenda = await drainSyncOutbox({
    userId: args.userId,
    ...passeArgs,
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
  })

  const handlers = await buildSyncHandlers()
  const file = await drainOutbox({ userId: args.userId, handlers, ...passeArgs })

  return {
    // « Aucun connecteur joignable » ne se dit que si vraiment aucun ne l'est.
    // Le laisser décidé par le seul agenda annoncerait une file intacte à
    // quelqu'un dont les CRA viennent de partir chez Dolibarr.
    nonConnecte: agenda.nonConnecte && Object.keys(handlers).length === 0,
    traitees: agenda.traitees + file.traitees,
    reussies: agenda.reussies + file.reussies,
    // Les divergences n'existent que côté agenda : le drainage générique ne lit
    // pas avant d'écrire, il rend un verdict. Rien à cumuler ici.
    conflits: agenda.conflits,
    echecs: agenda.echecs + file.echouees,
    reste: agenda.reste + file.reste,
  }
}

/**
 * Ce que le déclenchement externe (cron, n8n, `curl`) draine : tous les comptes.
 *
 * Les deux moitiés énumèrent des comptes différents, et c'est structurel — un
 * jeton d'agenda appartient à une personne, une clé d'API Dolibarr appartient à
 * l'instance. Côté gestionnaires, c'est donc la file qui dit qui drainer.
 */
export interface FlushAllReport {
  /** comptes dont l'agenda a été drainé */
  comptes: number
  /** lignes d'agenda traitées */
  traitees: number
  /** comptes dont la file par gestionnaires a été drainée */
  comptesFile: number
  traiteesFile: number
  reussiesFile: number
  echoueesFile: number
  /** lignes encore dues après les passes ; `0` = file vidée */
  resteFile: number
}

export async function flushAllProviders(
  limit = TAILLE_LOT,
  /** injectées par les tests ; la production n'en passe aucune */
  deps: { now?: Date; fetchFn?: FetchLike } = {},
): Promise<FlushAllReport> {
  const now = deps.now ?? new Date()
  const agenda = await flushAllSyncOutboxes(limit, {
    now,
    ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
  })

  // Construits une seule fois pour tous les comptes : la clé d'API est
  // d'instance, la reconstruire par compte relirait le même secret n fois.
  const handlers = await buildSyncHandlers()
  const comptes = await listPendingOutboxUsers(Object.keys(handlers))

  const rapport: FlushAllReport = {
    comptes: agenda.comptes,
    traitees: agenda.traitees,
    comptesFile: comptes.length,
    traiteesFile: 0,
    reussiesFile: 0,
    echoueesFile: 0,
    resteFile: 0,
  }

  for (const userId of comptes) {
    const r = await drainOutbox({ userId, handlers, limit, now })
    rapport.traiteesFile += r.traitees
    rapport.reussiesFile += r.reussies
    rapport.echoueesFile += r.echouees
    rapport.resteFile += r.reste
  }

  return rapport
}
