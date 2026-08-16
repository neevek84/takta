import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Authentification d'un webhook de signature.
 *
 * **Par signature de charge utile, jamais par un jeton dans l'URL.** Ce
 * webhook fait franchir une transition qui verrouille un mois et peut
 * déclencher une facturation en aval : un jeton d'URL fuit dans les journaux
 * d'accès, les en-têtes `Referer` et l'historique des proxys, et ne prouve
 * rien sur le contenu reçu, quand un HMAC prouve l'origine **et** l'intégrité.
 *
 * Module pur : `node:crypto` uniquement, ni Prisma, ni Next, ni React.
 */

const PREFIXE = 'sha256='

export function signWebhookPayload(rawBody: string, secret: string): string {
  return PREFIXE + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

/**
 * Comparaison à temps constant. Le secret étant vérifié à chaque appel, une
 * comparaison naïve laisserait fuiter le condensat attendu octet par octet.
 */
export function verifyWebhookSignature(
  rawBody: string,
  header: string,
  secret: string,
): boolean {
  // Sans secret configuré, aucune charge n'est authentique. Ne jamais
  // « laisser passer » ici : ce serait ouvrir la transition VALIDE à
  // n'importe quel appelant du réseau.
  if (secret === '') return false

  // Seul notre préfixe est retiré. Un `md5=<hex>` garde donc le sien, échoue
  // au format ci-dessous et n'est jamais comparé à un HMAC SHA-256 :
  // l'algorithme ne se négocie pas avec l'appelant.
  const brut = header.trim()
  const fourni = (brut.startsWith(PREFIXE) ? brut.slice(PREFIXE.length) : brut)
    .trim()
    .toLowerCase()

  if (!/^[0-9a-f]{64}$/.test(fourni)) return false

  const attendu = signWebhookPayload(rawBody, secret).slice(PREFIXE.length)

  const a = Buffer.from(fourni, 'hex')
  const b = Buffer.from(attendu, 'hex')
  // `timingSafeEqual` lève si les longueurs diffèrent ; le format ci-dessus
  // les garantit égales, ce test reste une ceinture de sécurité.
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}
