import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretBoxError'
  }
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(
      `La clé de chiffrement doit faire ${KEY_BYTES} octets une fois décodée (${key.length} reçus).`,
    )
  }
}

/** Décode et valide la clé fournie par l'environnement. */
export function parseKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64')
  assertKey(key)

  // `Buffer.from(…, 'base64')` ignore silencieusement tout caractère hors
  // alphabet : « motdepasse treslong quiressemble aunecle AAAAAA » décode à
  // exactement 32 octets et passerait donc pour une clé, sans en avoir
  // l'entropie. Ré-encoder démasque ces chaînes-là, les caractères ignorés ne
  // ressortant pas.
  //
  // La limite, assumée : une chaîne lisible composée uniquement de l'alphabet
  // base64 EST du base64 valide, et rien de syntaxique ne la distingue d'une
  // clé. D'où la commande de génération donnée dans le message.
  if (key.toString('base64').replace(/=+$/, '') !== base64.trim().replace(/=+$/, '')) {
    throw new SecretBoxError(
      "CREDENTIALS_KEY n'est pas une clé base64 valide de 32 octets. " +
        'Générez-en une avec : openssl rand -base64 32',
    )
  }

  return key
}

/**
 * AES-256-GCM. Le format porte sa version : le jour où l'algorithme change,
 * les jetons déjà stockés restent lisibles au lieu de devenir du bruit.
 * Le vecteur d'initialisation est tiré à chaque appel — sans lui, deux jetons
 * identiques produiraient le même chiffré et seraient reconnaissables en base.
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const chiffre = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    chiffre.toString('base64'),
  ].join('.')
}

export function decryptSecret(payload: string, key: Buffer): string {
  assertKey(key)

  const parts = payload.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxError('Le jeton chiffré est illisible : format inconnu.')
  }

  const iv = Buffer.from(parts[1] as string, 'base64')
  const tag = Buffer.from(parts[2] as string, 'base64')
  const chiffre = Buffer.from(parts[3] as string, 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretBoxError('Le jeton chiffré est illisible : en-tête invalide.')
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([decipher.update(chiffre), decipher.final()]).toString('utf8')
  } catch {
    // GCM authentifie : une clé fausse et une donnée altérée échouent ici, et
    // c'est exactement ce qu'on veut — jamais un déchiffrement silencieux.
    throw new SecretBoxError(
      "Le jeton chiffré n'a pas pu être déchiffré : clé incorrecte ou donnée altérée.",
    )
  }
}
