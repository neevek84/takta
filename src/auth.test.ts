import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './auth-password'

describe('mots de passe', () => {
  it('produit une empreinte différente du clair', async () => {
    const h = await hashPassword('motdepasse123')
    expect(h).not.toBe('motdepasse123')
    expect(h.length).toBeGreaterThan(20)
  })

  it('valide le bon mot de passe', async () => {
    const h = await hashPassword('motdepasse123')
    expect(await verifyPassword(h, 'motdepasse123')).toBe(true)
  })

  it('rejette un mauvais mot de passe', async () => {
    const h = await hashPassword('motdepasse123')
    expect(await verifyPassword(h, 'mauvais')).toBe(false)
  })

  it('produit deux empreintes différentes pour le même clair', async () => {
    const a = await hashPassword('identique')
    const b = await hashPassword('identique')
    expect(a).not.toBe(b)
  })
})
