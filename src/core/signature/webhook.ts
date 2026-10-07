import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Authentification d'un webhook de signature.
 *
 * **Deux preuves d'origine, jamais un jeton dans l'URL.** Un jeton d'URL fuit
 * dans les journaux d'accès, les en-têtes `Referer` et l'historique des
 * proxys. Sont acceptés :
 *
 * - le secret partagé que Documenso recopie dans `X-Documenso-Secret`
 *   (`verifierSecretDocumenso`) — c'est ce que Documenso envoie réellement ;
 * - un HMAC SHA-256 de la charge dans `x-cra-signature`
 *   (`verifyWebhookSignature`), pour les intégrations maison et les tests.
 *
 * Ni l'un ni l'autre n'est cru sur le contenu : le service relit l'état de
 * l'enveloppe chez le prestataire avant d'appliquer quoi que ce soit
 * (`services/signature/webhook.ts`).
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

/**
 * **Documenso ne signe pas ses webhooks** : il recopie le secret configuré
 * dans l'en-tête `X-Documenso-Secret` (`execute-webhook-call.ts`, et sa
 * documentation « Verification »). Le lot 3 attendait un HMAC ; chaque
 * webhook réel recevait donc 401.
 *
 * Un secret partagé prouve l'**origine**, pas l'**intégrité** : c'est pourquoi
 * le service ne croit plus la charge et relit l'état chez le prestataire
 * (`services/signature/webhook.ts`).
 *
 * Les deux valeurs sont hachées avant comparaison : `timingSafeEqual` exige
 * deux longueurs égales, et comparer les longueurs d'abord révélerait celle du
 * secret.
 */
export function verifierSecretDocumenso(header: string, secret: string): boolean {
  if (secret === '' || header === '') return false
  const a = createHash('sha256').update(header, 'utf8').digest()
  const b = createHash('sha256').update(secret, 'utf8').digest()
  return timingSafeEqual(a, b)
}
