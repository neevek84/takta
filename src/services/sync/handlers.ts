import { DOLIBARR } from '@/services/dolibarr/api'
import { createDolibarrHandler } from '@/services/dolibarr/push'
import { getDolibarrApi } from '@/services/dolibarr/resolve'
import type { SyncHandler } from './types'

/**
 * Les gestionnaires de fournisseur réellement disponibles, à cet instant.
 *
 * C'est le seul endroit du code de production où un fournisseur entre dans le
 * drainage générique. Tant que ce câblage n'existait pas, `flushOutbox` et
 * `createDolibarrHandler` n'étaient appelés que par des tests : un CRA validé
 * s'inscrivait dans la file, et rien ne l'en sortait — sans erreur, sans
 * message, sans le moindre écran pour le dire.
 *
 * **Un fournisseur non connecté n'apparaît pas**, et c'est le comportement
 * voulu : `flushOutbox` ne lit même pas les lignes d'un fournisseur sans
 * gestionnaire, qui restent en attente au lieu de consommer leur quota de
 * tentatives. Saisir la clé d'API suffit alors à les faire repartir, sans
 * réarmement manuel.
 *
 * Reconstruit à chaque déclenchement, jamais mémorisé : la clé d'API peut
 * avoir été saisie, changée ou retirée depuis le démarrage du serveur, et un
 * gestionnaire mis en cache pousserait avec un secret révoqué.
 */
export async function buildSyncHandlers(): Promise<Record<string, SyncHandler>> {
  const handlers: Record<string, SyncHandler> = {}

  const dolibarr = await getDolibarrApi()
  if (dolibarr !== null) handlers[DOLIBARR] = createDolibarrHandler(dolibarr)

  return handlers
}
