import { describe, it, expect } from 'vitest'
import { signPayload, verifySignature } from './signature'

const SECRET = 'un-secret-d-abonnement'
const CORPS = '{"event":"cra.valide","seq":1234}'

describe('signature du corps brut', () => {
  it('est reproductible', () => {
    expect(signPayload(SECRET, CORPS)).toBe(signPayload(SECRET, CORPS))
  })

  it('est un HMAC-SHA256 préfixé', () => {
    expect(signPayload(SECRET, CORPS)).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('un consommateur la recalcule et retrouve l en-tête', () => {
    const entete = signPayload(SECRET, CORPS)
    expect(verifySignature(SECRET, CORPS, entete)).toBe(true)
  })

  it('une charge utile altérée d un octet ne valide plus', () => {
    const entete = signPayload(SECRET, CORPS)
    expect(verifySignature(SECRET, `${CORPS} `, entete)).toBe(false)
    expect(verifySignature(SECRET, CORPS.replace('1234', '1235'), entete)).toBe(false)
  })

  it('un autre secret ne valide pas', () => {
    expect(verifySignature('autre-secret', CORPS, signPayload(SECRET, CORPS))).toBe(false)
  })

  it('ne lève pas sur un en-tête tronqué, vide ou absurde', () => {
    // Le comparateur à temps constant jette sur des longueurs différentes :
    // sans garde, un en-tête malformé ferait tomber le serveur.
    for (const entete of ['', 'sha256=', 'nawak', 'sha256=zz']) {
      expect(verifySignature(SECRET, CORPS, entete)).toBe(false)
    }
  })
})
