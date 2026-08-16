import { createHash } from 'node:crypto'

/** L'ancrage de la toute première entrée. La chaîne part de nulle part. */
export const GENESIS_HASH = ''

/**
 * `\u001f` — « unit separator ». Il ne peut apparaître dans aucun champ :
 * `payloadJson` est produit par `JSON.stringify`, qui échappe tout caractère
 * de contrôle sous la forme `\u001f` (six caractères imprimables), et les
 * autres champs sont des identifiants, des libellés ou des dates ISO.
 */
const SEPARATEUR = '\u001f'

export interface AuditEntryContent {
  /** numéro d'ordre, strictement croissant */
  seq: number
  /** horodatage, sérialisé une seule fois pour que l'empreinte soit stable */
  occurredAtIso: string
  /** '' pour un traitement de fond */
  actorId: string
  actorLabel: string
  action: string
  entityType: string
  entityId: string
  payloadJson: string
  prevHash: string
}

/**
 * Encodage **positionnel**, et non `JSON.stringify` d'un objet : l'ordre des
 * clés d'un objet construit dynamiquement n'est pas un contrat de langage, et
 * une empreinte qui dépend de l'ordre des clés ne prouve rien le jour où le
 * mappage change.
 */
function canonicalise(c: AuditEntryContent): string {
  return [
    String(c.seq),
    c.occurredAtIso,
    c.actorId,
    c.actorLabel,
    c.action,
    c.entityType,
    c.entityId,
    c.payloadJson,
    c.prevHash,
  ].join(SEPARATEUR)
}

/** L'empreinte du contenu de l'entrée **et de `prevHash`** : c'est ce lien qui chaîne. */
export function hashAuditEntry(contenu: AuditEntryContent): string {
  return createHash('sha256').update(canonicalise(contenu), 'utf8').digest('hex')
}

export type ChainVerdict =
  | { ok: true; verifiees: number }
  | {
      ok: false
      /** nombre d'entrées vérifiées avant la rupture */
      verifiees: number
      /** numéro d'ordre de la première entrée en défaut */
      seq: number
      raison: 'EMPREINTE' | 'CHAINAGE' | 'ORDRE'
    }

/**
 * Recalcule la chaîne et signale **la première** rupture.
 *
 * Trois défauts distincts, parce qu'ils ne racontent pas la même histoire :
 * `ORDRE` = la numérotation ne progresse plus ; `CHAINAGE` = une entrée a été
 * insérée, retirée, ou une entrée antérieure a été réécrite puis rehachée ;
 * `EMPREINTE` = le contenu de cette entrée-ci ne correspond plus à son hash.
 *
 * `ancrage` permet de vérifier une fenêtre à partir de l'empreinte de la
 * dernière entrée déjà contrôlée, sans relire tout le journal.
 */
export function verifyAuditChain(
  entries: ReadonlyArray<AuditEntryContent & { hash: string }>,
  ancrage: string = GENESIS_HASH,
): ChainVerdict {
  let precedentHash = ancrage
  let precedentSeq = 0

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!

    if (e.seq <= precedentSeq) {
      return { ok: false, verifiees: i, seq: e.seq, raison: 'ORDRE' }
    }
    if (e.prevHash !== precedentHash) {
      return { ok: false, verifiees: i, seq: e.seq, raison: 'CHAINAGE' }
    }
    if (hashAuditEntry(e) !== e.hash) {
      return { ok: false, verifiees: i, seq: e.seq, raison: 'EMPREINTE' }
    }

    precedentHash = e.hash
    precedentSeq = e.seq
  }

  return { ok: true, verifiees: entries.length }
}
