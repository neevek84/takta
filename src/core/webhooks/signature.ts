import { createHmac, timingSafeEqual } from 'node:crypto'

const PREFIXE = 'sha256='

/**
 * HMAC-SHA256 du **corps brut**, avec le secret propre à l'abonnement.
 * Sans elle, quiconque connaît l'URL peut déclencher un flux en fabriquant
 * un faux événement.
 */
export function signPayload(secret: string, corpsBrut: string): string {
  return PREFIXE + createHmac('sha256', secret).update(corpsBrut, 'utf8').digest('hex')
}

/**
 * Comparaison à temps constant. `timingSafeEqual` **lève** sur deux tampons
 * de longueurs différentes : la garde de longueur n'est pas une optimisation,
 * c'est ce qui empêche un en-tête malformé de faire tomber le serveur.
 */
export function verifySignature(secret: string, corpsBrut: string, entete: string): boolean {
  const attendu = Buffer.from(signPayload(secret, corpsBrut), 'utf8')
  const fourni = Buffer.from(entete, 'utf8')
  if (attendu.length !== fourni.length) return false
  return timingSafeEqual(attendu, fourni)
}
