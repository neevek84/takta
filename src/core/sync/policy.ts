export type SyncOperation = 'UPSERT' | 'DELETE'
export type SyncState = 'PENDING' | 'FAILED'
export type ConflictKind = 'REMOTE_MODIFIED' | 'REMOTE_DELETED'
export type ConflictResolution = 'RETABLIR' | 'ACCEPTER' | 'DETACHER'

export const SYNC_OPERATIONS: readonly SyncOperation[] = ['UPSERT', 'DELETE']
export const CONFLICT_RESOLUTIONS: readonly ConflictResolution[] = [
  'RETABLIR',
  'ACCEPTER',
  'DETACHER',
]

/** Le seul fournisseur du lot ; la colonne reste générique pour la suite. */
export const PROVIDER_GOOGLE = 'GOOGLE'
/** La seule entité synchronisée du lot 1b : une ligne de temps, un événement. */
export const ENTITY_TIME_ENTRY = 'TimeEntry'
/**
 * La cible du connecteur Dolibarr : un CRA validé, dont on pousse les temps
 * réalisés (lot 2).
 *
 * Nommée ici, à côté de `ENTITY_TIME_ENTRY`, parce que trois modules doivent
 * s'accorder dessus sans jamais se lire : celui qui met en file (tâche 8),
 * celui qui draine, et le gestionnaire qui refuse tout ce qu'il ne sait pas
 * traiter. Une chaîne recopiée dans chacun aurait divergé en silence — un
 * gestionnaire qui refuse « CRA » quand la file dépose « Cra » ne lève rien,
 * il abandonne la ligne.
 */
export const ENTITY_CRA = 'Cra'

/** Recul progressif : 1 min, 5 min, 15 min, 1 h, 6 h. */
export const RETRY_DELAYS_MINUTES: readonly number[] = [1, 5, 15, 60, 360]
export const MAX_ATTEMPTS = 5

/**
 * Taille d'un lot de drainage, commune à tous les fournisseurs.
 *
 * Elle vivait dans `services/sync/flush.ts`, d'où le drainage générique ne
 * pouvait pas la lire sans fermer un cycle d'imports
 * (`outbox → flush → time-entries → outbox`). Une valeur par défaut recopiée à
 * chaque étage se contredit sans que rien ne le dise, et c'est exactement le
 * genre de constante qu'aucun test ne pince quand elle est dupliquée.
 */
export const TAILLE_LOT = 50

/**
 * Nombre maximal de passes par compte et par déclenchement.
 *
 * Un drainage traite au plus `TAILLE_LOT` lignes et ne s'enchaîne pas de
 * lui-même : sans reprise, un déclenchement laisserait derrière lui tout ce qui
 * dépasse, et une file de 200 lignes attendrait quatre déclenchements pour
 * partir. La borne, elle, garde la main : au-delà de 20 × 50 lignes en un seul
 * passage, ce n'est plus un retard mais un défaut, et boucler sans fin sur un
 * compte priverait tous les suivants de leur drainage.
 *
 * Elle vit ici, avec `TAILLE_LOT`, parce que deux drainages l'appliquent
 * désormais — celui de l'agenda et le générique. Recopiée dans chacun, elle se
 * contredirait sans que rien ne le dise.
 */
export const MAX_PASSES = 20

export interface NextAttempt {
  state: SyncState
  attempts: number
  nextAttemptAt: Date
}

/**
 * Décide de la suite après un échec.
 *
 * Au-delà du quota, l'état passe à `FAILED` — **et la ligne reste en base**.
 * Une file qui perdrait ses échecs produirait un agenda silencieusement faux,
 * exactement la dérive qu'on ne détecte que trois mois plus tard.
 */
/**
 * Renonce sans consommer le quota restant, pour un échec que rejouer ne
 * réparera pas (requête refusée pour son contenu, `CalendarErrorKind` =
 * `INVALID`).
 *
 * Le recul progressif suppose une panne qui passe ; une erreur permanente
 * rejouée cinq fois produit cinq lignes de bruit et noie les pannes réelles
 * dans l'écran de synchronisation. La ligne **reste en base** en `FAILED`,
 * comme après un quota épuisé : le seul écart est le nombre de tentatives
 * gâchées pour y arriver.
 */
export function abandon(attemptsSoFar: number, now: Date): NextAttempt {
  return { state: 'FAILED', attempts: attemptsSoFar + 1, nextAttemptAt: now }
}

export function nextAttempt(attemptsSoFar: number, now: Date): NextAttempt {
  const attempts = attemptsSoFar + 1
  const index = Math.min(attempts - 1, RETRY_DELAYS_MINUTES.length - 1)
  const delai = RETRY_DELAYS_MINUTES[index] as number

  return {
    state: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
    attempts,
    nextAttemptAt: new Date(now.getTime() + delai * 60_000),
  }
}
