import { describe, it, expect } from 'vitest'
import {
  CODE_DUREE_MINUTES,
  CODE_ESSAIS_MAX,
  CODES_PAR_HEURE_MAX,
  SESSION_CLIENT_MINUTES,
  empreinteCode,
  fabriquerCode,
  lireSessionClient,
  masquerEmail,
  signerSessionClient,
} from './code-client'

const SECRET = 'secret-de-test'

describe('code client', () => {
  it('reprend les valeurs de la spec', () => {
    expect(CODE_DUREE_MINUTES).toBe(10)
    expect(CODE_ESSAIS_MAX).toBe(5)
    expect(CODES_PAR_HEURE_MAX).toBe(5)
    expect(SESSION_CLIENT_MINUTES).toBe(120)
  })

  it('fabrique six chiffres, zéros de tête compris', () => {
    for (let i = 0; i < 200; i += 1) expect(fabriquerCode()).toMatch(/^\d{6}$/)
  })

  it("l'empreinte dépend du lien, du code et du secret", () => {
    const base = empreinteCode('lien-a', '123456', SECRET)
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    expect(empreinteCode('lien-a', '123456', SECRET)).toBe(base)
    expect(empreinteCode('lien-b', '123456', SECRET)).not.toBe(base)
    expect(empreinteCode('lien-a', '123457', SECRET)).not.toBe(base)
    expect(empreinteCode('lien-a', '123456', 'autre')).not.toBe(base)
  })
})

describe('session client', () => {
  const maintenant = new Date('2026-10-07T10:00:00Z')
  const expire = new Date('2026-10-07T12:00:00Z')

  it('rend le lien signé tant que la session vit', () => {
    const v = signerSessionClient('lien-a', expire, SECRET)
    expect(lireSessionClient(v, SECRET, maintenant)).toBe('lien-a')
  })

  it("refuse une session expirée, à la seconde près", () => {
    const v = signerSessionClient('lien-a', expire, SECRET)
    expect(lireSessionClient(v, SECRET, expire)).toBeNull()
  })

  it('refuse une session falsifiée ou signée par un autre secret', () => {
    const v = signerSessionClient('lien-a', expire, SECRET)
    const [, exp, mac] = v.split('.')
    expect(lireSessionClient(`lien-b.${exp}.${mac}`, SECRET, maintenant)).toBeNull()
    expect(lireSessionClient(v, 'autre', maintenant)).toBeNull()
    expect(lireSessionClient('n.importe.quoi', SECRET, maintenant)).toBeNull()
    expect(lireSessionClient('', SECRET, maintenant)).toBeNull()
  })

  it('refuse tout sans secret', () => {
    const v = signerSessionClient('lien-a', expire, SECRET)
    expect(lireSessionClient(v, '', maintenant)).toBeNull()
  })
})

describe('masquerEmail', () => {
  it("ne laisse voir que l'initiale et le domaine", () => {
    expect(masquerEmail('jeanne.martin@client.fr')).toBe('j•••@client.fr')
    expect(masquerEmail('a@b.fr')).toBe('a•••@b.fr')
  })

  it('ne lève pas sur une adresse sans arobase', () => {
    expect(masquerEmail('invalide')).toBe('•••')
  })
})
