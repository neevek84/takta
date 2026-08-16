import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptSecret, decryptSecret, parseKey, SecretBoxError } from './secret-box'

const KEY = randomBytes(32)

describe('secret-box', () => {
  it('rend le clair après un aller-retour', () => {
    const chiffre = encryptSecret('1//refresh-token-de-longue-duree', KEY)
    expect(decryptSecret(chiffre, KEY)).toBe('1//refresh-token-de-longue-duree')
  })

  it('ne laisse jamais le clair apparaître dans le chiffré', () => {
    const chiffre = encryptSecret('1//refresh-token-de-longue-duree', KEY)
    expect(chiffre).not.toContain('refresh-token')
  })

  it('produit deux chiffrés différents pour le même clair', () => {
    // Sans vecteur d'initialisation aléatoire, deux jetons identiques
    // seraient reconnaissables l'un de l'autre dans la base.
    expect(encryptSecret('meme-secret', KEY)).not.toBe(encryptSecret('meme-secret', KEY))
  })

  it('refuse de déchiffrer avec une autre clé', () => {
    const chiffre = encryptSecret('secret', KEY)
    expect(() => decryptSecret(chiffre, randomBytes(32))).toThrow(SecretBoxError)
  })

  it('détecte une altération du chiffré', () => {
    const chiffre = encryptSecret('secret', KEY)
    const parts = chiffre.split('.')
    const altere = [parts[0], parts[1], parts[2], Buffer.from('autre').toString('base64')].join('.')
    expect(() => decryptSecret(altere, KEY)).toThrow(SecretBoxError)
  })

  it('refuse un format inconnu', () => {
    expect(() => decryptSecret('pas-un-jeton', KEY)).toThrow(SecretBoxError)
    expect(() => decryptSecret('v9.a.b.c', KEY)).toThrow(SecretBoxError)
  })

  // Hors brief : sans ce test, retirer la vérification de version laissait les
  // 19 tests verts — `v9.a.b.c` tombait sur le contrôle d'en-tête, pas sur
  // celui de la version. Un jeton d'un format futur serait alors déchiffré par
  // l'algorithme d'aujourd'hui, ce que le préfixe existe précisément pour éviter.
  it('refuse une version de format qu il ne connaît pas', () => {
    const parts = encryptSecret('secret', KEY).split('.')
    const futur = ['v2', parts[1], parts[2], parts[3]].join('.')
    expect(() => decryptSecret(futur, KEY)).toThrow(SecretBoxError)
  })

  // Hors brief, même raison : sans ce test, retirer le contrôle des longueurs
  // d'en-tête restait invisible. Une étiquette de longueur invalide fait lever
  // `node:crypto` depuis `setAuthTag`, hors du bloc protégé — l'appelant
  // recevrait une erreur qui n'est pas une SecretBoxError.
  it('refuse un en-tête tronqué sans laisser fuir une autre erreur', () => {
    const parts = encryptSecret('secret', KEY).split('.')
    const tagCourt = [parts[0], parts[1], Buffer.alloc(5).toString('base64'), parts[3]].join('.')
    const ivCourt = [parts[0], Buffer.alloc(4).toString('base64'), parts[2], parts[3]].join('.')
    expect(() => decryptSecret(tagCourt, KEY)).toThrow(SecretBoxError)
    expect(() => decryptSecret(ivCourt, KEY)).toThrow(SecretBoxError)
  })

  it('gère un clair vide et un clair accentué', () => {
    expect(decryptSecret(encryptSecret('', KEY), KEY)).toBe('')
    expect(decryptSecret(encryptSecret('clé été à', KEY), KEY)).toBe('clé été à')
  })

  it('refuse une clé qui ne fait pas 32 octets', () => {
    expect(() => parseKey(randomBytes(16).toString('base64'))).toThrow(SecretBoxError)
    expect(() => encryptSecret('secret', randomBytes(16))).toThrow(SecretBoxError)
  })

  it('accepte une clé de 32 octets encodée en base64', () => {
    const key = randomBytes(32)
    expect(parseKey(key.toString('base64')).equals(key)).toBe(true)
  })
})
