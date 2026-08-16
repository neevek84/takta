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
/** La seule entité synchronisée du lot : une ligne de temps, un événement. */
export const ENTITY_TIME_ENTRY = 'TimeEntry'

/** Recul progressif : 1 min, 5 min, 15 min, 1 h, 6 h. */
export const RETRY_DELAYS_MINUTES: readonly number[] = [1, 5, 15, 60, 360]
export const MAX_ATTEMPTS = 5

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
