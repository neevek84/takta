import { describe, it, expect } from 'vitest'
import { signWebhookPayload, verifyWebhookSignature } from './webhook'

const SECRET = 'un-secret-de-webhook'
const CHARGE = JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 42 } })

describe('signWebhookPayload', () => {
  it('produit une signature préfixée et hexadécimale', () => {
    const signature = signWebhookPayload(CHARGE, SECRET)
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('est déterministe', () => {
    expect(signWebhookPayload(CHARGE, SECRET)).toBe(signWebhookPayload(CHARGE, SECRET))
  })

  it('change dès que la charge ou le secret change', () => {
    expect(signWebhookPayload(CHARGE, SECRET)).not.toBe(signWebhookPayload(`${CHARGE} `, SECRET))
    expect(signWebhookPayload(CHARGE, SECRET)).not.toBe(signWebhookPayload(CHARGE, 'autre'))
  })
})

describe('verifyWebhookSignature', () => {
  it('accepte une charge correctement signée', () => {
    expect(verifyWebhookSignature(CHARGE, signWebhookPayload(CHARGE, SECRET), SECRET)).toBe(true)
  })

  it('REFUSE une charge modifiée après signature', () => {
    // Le cœur du sujet : on ne protège pas l origine, on protège le contenu.
    const signature = signWebhookPayload(CHARGE, SECRET)
    const falsifiee = JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { id: 99 } })
    expect(verifyWebhookSignature(falsifiee, signature, SECRET)).toBe(false)
  })

  it('refuse une signature produite avec un autre secret', () => {
    expect(verifyWebhookSignature(CHARGE, signWebhookPayload(CHARGE, 'autre'), SECRET)).toBe(false)
  })

  it('refuse quand le secret n est pas configuré', () => {
    // Un endpoint public qui verrouille un mois ne s ouvre pas « par défaut ».
    expect(verifyWebhookSignature(CHARGE, signWebhookPayload(CHARGE, ''), '')).toBe(false)
  })

  it('refuse un en-tête absent, vide ou mal formé sans jamais lever', () => {
    for (const entete of ['', 'sha256=', 'sha256=zz', 'nimporte quoi', 'md5=abcd']) {
      expect(verifyWebhookSignature(CHARGE, entete, SECRET)).toBe(false)
    }
  })

  it('supporte une signature de longueur différente sans lever', () => {
    // `timingSafeEqual` lève sur des longueurs différentes : le garde-fou
    // doit être explicite, sinon l endpoint rend 500 au lieu de 401.
    expect(() => verifyWebhookSignature(CHARGE, 'sha256=abcdef', SECRET)).not.toThrow()
    expect(verifyWebhookSignature(CHARGE, 'sha256=abcdef', SECRET)).toBe(false)
  })

  it('accepte la signature quel que soit la casse de l hexadécimal', () => {
    const signature = signWebhookPayload(CHARGE, SECRET)
    expect(verifyWebhookSignature(CHARGE, signature.toUpperCase().replace('SHA256', 'sha256'), SECRET)).toBe(true)
  })

  it('tolère l absence de préfixe', () => {
    const hex = signWebhookPayload(CHARGE, SECRET).slice('sha256='.length)
    expect(verifyWebhookSignature(CHARGE, hex, SECRET)).toBe(true)
  })

  it('refuse une signature valide accompagnée d un préfixe d un autre algorithme', () => {
    // `md5=<hmac sha256 valide>` ne doit pas passer par la porte « pas de
    // préfixe » : on ne négocie pas l algorithme avec l appelant.
    const hex = signWebhookPayload(CHARGE, SECRET).slice('sha256='.length)
    expect(verifyWebhookSignature(CHARGE, `md5=${hex}`, SECRET)).toBe(false)
    expect(verifyWebhookSignature(CHARGE, `sha1=${hex}`, SECRET)).toBe(false)
  })

  it('refuse une charge vide signée d une signature d une autre charge', () => {
    expect(verifyWebhookSignature('', signWebhookPayload(CHARGE, SECRET), SECRET)).toBe(false)
  })

  it('signe et vérifie les octets tels quels, espaces compris', () => {
    // Un HMAC porte sur les octets reçus. Un aller-retour JSON qui
    // réordonnerait les clés produirait une charge différente, donc invalide :
    // c est voulu, et c est pourquoi la route lit le corps en texte brut.
    const espace = `${CHARGE}\n`
    expect(verifyWebhookSignature(espace, signWebhookPayload(CHARGE, SECRET), SECRET)).toBe(false)
    expect(verifyWebhookSignature(espace, signWebhookPayload(espace, SECRET), SECRET)).toBe(true)
  })
})
