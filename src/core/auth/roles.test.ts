import { describe, it, expect } from 'vitest'
import { MOTIF_REFUS_ADMIN, ROLES, estRole, peutAdministrer } from './roles'

describe('peutAdministrer', () => {
  it('ouvre l administration au seul ADMIN', () => {
    expect(peutAdministrer('ADMIN')).toBe(true)
  })

  // `MANAGER` sonne comme un rôle d'encadrement, et c'est justement le piège :
  // il n'administre ni la clé d'API de l'instance, ni le client OAuth, ni les
  // rôles des autres. Tant qu'aucun écran ne lui est propre, il ne peut rien de
  // plus qu'un consultant.
  it("n'ouvre rien à MANAGER ni à CONSULTANT", () => {
    expect(peutAdministrer('MANAGER')).toBe(false)
    expect(peutAdministrer('CONSULTANT')).toBe(false)
  })

  it('couvre tous les rôles déclarés, sans en oublier un', () => {
    for (const role of ROLES) expect(typeof peutAdministrer(role)).toBe('boolean')
    expect(ROLES.filter(peutAdministrer)).toEqual(['ADMIN'])
  })
})

describe('estRole', () => {
  it('reconnaît les trois rôles', () => {
    expect(ROLES.every(estRole)).toBe(true)
  })

  // Le rôle vient d'une colonne `String`, pas d'une énumération de la base :
  // une valeur inventée à la main en SQL ne doit jamais être promue en `Role`.
  it("refuse ce qui n'en est pas un", () => {
    expect(estRole('ROOT')).toBe(false)
    expect(estRole('admin')).toBe(false)
    expect(estRole('')).toBe(false)
  })
})

describe('le motif du refus', () => {
  // Une redirection muette apprend que l'écran n'existe pas ; un refus nommé
  // apprend à qui demander. Le motif doit donc dire les deux : ce qui est exigé,
  // et vers qui se tourner.
  it('dit ce qui est exigé et à qui le demander', () => {
    expect(MOTIF_REFUS_ADMIN).toMatch(/administrateur/i)
    expect(MOTIF_REFUS_ADMIN.length).toBeGreaterThan(40)
  })
})
