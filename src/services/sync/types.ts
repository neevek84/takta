import type { SyncOperation, SyncState } from '@/core/sync/policy'

// Réexportés, jamais redéclarés : `SyncOperation` et `SyncState` décrivent les
// valeurs écrites en base et le quota de tentatives qui les fait passer de
// l'une à l'autre. Ils appartiennent au noyau, avec `nextAttempt` et
// `abandon` qui les produisent. En redéclarer une copie ici laisserait les
// deux dériver sans qu'aucun test ne s'en aperçoive — les unions littérales
// n'ont pas d'identité nominale en TypeScript.
export type { SyncOperation, SyncState }

/**
 * Une ligne de file telle qu'un gestionnaire de fournisseur la reçoit.
 *
 * Rien de Google ni de Dolibarr n'y figure : `entityType` et `entityId`
 * désignent la cible dans le langage de l'application, et c'est au
 * gestionnaire de savoir ce qu'il en fait.
 */
export interface SyncJob {
  id: string
  /**
   * Propriétaire de la **cible**, pas du fournisseur.
   *
   * La distinction porte tout le lot 2 : une clé d'API Dolibarr appartient à
   * l'instance (`ownerScope = 'INSTANCE'`), mais le CRA qu'elle pousse
   * appartient à quelqu'un. Un gestionnaire qui lirait des données doit donc
   * scoper ses requêtes sur ce `userId` même quand son fournisseur, lui,
   * n'est rattaché à personne.
   */
  userId: string
  entityType: string
  entityId: string
  provider: string
  operation: SyncOperation
  /** tentatives déjà consommées, avant celle-ci */
  attempts: number
  /** contexte de rejeu déposé à la mise en file ; `{}` quand il n'y en a pas */
  payload: Record<string, string>
}

/**
 * Le verdict d'un gestionnaire sur une ligne.
 *
 * `retriable: false` signifie « rejouer ceci à l'identique n'aboutira jamais »
 * (une requête refusée pour son contenu, une correspondance absente) : la
 * ligne part directement en `FAILED` et remonte à l'écran de supervision, au
 * lieu d'occuper la file pendant six heures et d'y noyer les pannes réelles
 * sous cinq lignes de bruit.
 */
export type SyncOutcome = { ok: true } | { ok: false; retriable: boolean; message: string }

/**
 * Ce qu'un fournisseur doit savoir faire pour que la file le draine.
 *
 * Un gestionnaire ne lève pas pour signaler un échec — il rend un verdict, et
 * c'est lui qui tranche entre « réessaie » et « n'insiste pas ». Une exception
 * qui s'échappe malgré tout est traitée comme rejouable par le drainage : une
 * panne non prévue ne doit pas condamner une ligne définitivement.
 */
export interface SyncHandler {
  upsert(job: SyncJob): Promise<SyncOutcome>
  remove(job: SyncJob): Promise<SyncOutcome>
}
