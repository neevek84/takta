/**
 * Les règles du code à usage unique et de la session du client.
 *
 * Pur : `node:crypto` seulement, et l'heure toujours passée en argument.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export const CODE_DUREE_MINUTES = 10
export const CODE_ESSAIS_MAX = 5
export const CODES_PAR_HEURE_MAX = 5
export const SESSION_CLIENT_MINUTES = 120

/** Six chiffres, tirés uniformément — `randomInt` et non `Math.random`. */
export function fabriquerCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * L'empreinte stockée. **HMAC, et non SHA-256 nu** : un million de codes se
 * parcourent en un instant, et une copie de la base ne doit pas suffire à
 * retrouver un code en cours. Le lien entre dans le message, pour qu'un même
 * code sur deux liens n'ait pas la même empreinte.
 */
export function empreinteCode(lienId: string, code: string, secret: string): string {
  return createHmac('sha256', secret).update(`${lienId}:${code}`, 'utf8').digest('hex')
}

function mac(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex')
}

/** `lienId.expirationEnMs.hmac` — lisible, mais infalsifiable sans le secret. */
export function signerSessionClient(lienId: string, expireAt: Date, secret: string): string {
  const corps = `${lienId}.${expireAt.getTime()}`
  return `${corps}.${mac(corps, secret)}`
}

/**
 * Le lien que la session ouvre, ou `null`. Comparaison à temps constant ; sans
 * secret, aucune session n'est valide — jamais de repli permissif.
 */
export function lireSessionClient(valeur: string, secret: string, maintenant: Date): string | null {
  if (secret === '') return null
  const morceaux = valeur.split('.')
  if (morceaux.length !== 3) return null
  const [lienId, exp, fourni] = morceaux as [string, string, string]
  if (lienId === '' || !/^\d+$/.test(exp) || !/^[0-9a-f]{64}$/.test(fourni)) return null

  const attendu = mac(`${lienId}.${exp}`, secret)
  if (!timingSafeEqual(Buffer.from(attendu, 'hex'), Buffer.from(fourni, 'hex'))) return null
  if (maintenant.getTime() >= Number(exp)) return null
  return lienId
}

/** `jeanne.martin@client.fr` → `j•••@client.fr` : de quoi se reconnaître, pas de quoi être lu. */
export function masquerEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '•••'
  return `${email[0]}•••${email.slice(at)}`
}
