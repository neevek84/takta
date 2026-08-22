/**
 * Les règles d'un lien de réinitialisation de mot de passe.
 *
 * Pur : aucune base, aucun réseau. `maintenant` est toujours passé en argument —
 * une expiration qui lit l'horloge ne se teste pas.
 */
import { createHash, randomBytes } from 'node:crypto'

/**
 * Dix minutes.
 *
 * Court est plus sûr, et le prix est connu : un courriel qui traîne dans une
 * file d'attente peut arriver après l'expiration. Le remède est d'en redemander
 * un, et l'écran le dit.
 */
export const DUREE_LIEN_MINUTES = 10

/** Un secret de 256 bits, hexadécimal : c'est lui qui voyage dans l'URL. */
export function fabriquerJeton(): string {
  return randomBytes(32).toString('hex')
}

/**
 * L'empreinte que la base porte — **jamais le jeton**.
 *
 * SHA-256 et non argon2, contrairement aux mots de passe : un secret de 256 bits
 * tiré au hasard n'a pas de dictionnaire, donc rien à ralentir. Ralentir ici ne
 * protégerait de rien et coûterait à chaque vérification.
 */
export function empreinteJeton(jeton: string): string {
  return createHash('sha256').update(jeton).digest('hex')
}

export function expirationDepuis(maintenant: Date): Date {
  return new Date(maintenant.getTime() + DUREE_LIEN_MINUTES * 60_000)
}

/** Un lien atteint sa seconde d'expiration est expiré, pas encore valide. */
export function lienExpire(expiration: Date, maintenant: Date): boolean {
  return maintenant.getTime() >= expiration.getTime()
}
