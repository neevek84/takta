import { describe, it, expect } from 'vitest'
import {
  DUREE_LIEN_MINUTES,
  empreinteJeton,
  expirationDepuis,
  fabriquerJeton,
  lienExpire,
} from './reinitialisation'

describe('fabriquerJeton', () => {
  it('rend 32 octets, en hexadécimal', () => {
    expect(fabriquerJeton()).toMatch(/^[0-9a-f]{64}$/)
  })

  // Un jeton prévisible serait un mot de passe universel à durée limitée.
  it('ne rend jamais deux fois le même', () => {
    const tires = new Set(Array.from({ length: 200 }, () => fabriquerJeton()))
    expect(tires.size).toBe(200)
  })
})

describe('empreinteJeton', () => {
  // La base porte l'empreinte, jamais le jeton : une base qui fuite ne doit pas
  // livrer des liens utilisables.
  it('ne laisse pas retrouver le jeton', () => {
    const jeton = fabriquerJeton()
    expect(empreinteJeton(jeton)).not.toContain(jeton)
    expect(empreinteJeton(jeton)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rend la même empreinte pour le même jeton', () => {
    const jeton = fabriquerJeton()
    expect(empreinteJeton(jeton)).toBe(empreinteJeton(jeton))
  })

  it('rend une empreinte différente pour un autre jeton', () => {
    expect(empreinteJeton('a')).not.toBe(empreinteJeton('b'))
  })
})

describe("l'expiration", () => {
  it('est de dix minutes', () => {
    expect(DUREE_LIEN_MINUTES).toBe(10)
    const depart = new Date('2026-08-22T10:00:00.000Z')
    expect(expirationDepuis(depart).toISOString()).toBe('2026-08-22T10:10:00.000Z')
  })

  it('juge un lien encore valide une seconde avant', () => {
    const expiration = new Date('2026-08-22T10:10:00.000Z')
    expect(lienExpire(expiration, new Date('2026-08-22T10:09:59.000Z'))).toBe(false)
  })

  // À la seconde près : un lien « valide pile à l'expiration » est un lien dont
  // la durée n'est pas celle qu'on annonce.
  it('juge un lien expiré à sa seconde d expiration', () => {
    const expiration = new Date('2026-08-22T10:10:00.000Z')
    expect(lienExpire(expiration, new Date('2026-08-22T10:10:00.000Z'))).toBe(true)
  })
})
