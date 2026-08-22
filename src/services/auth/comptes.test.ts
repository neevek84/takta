import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { hashPassword } from '@/auth-password'
import { aUnMotDePasse, aucunUtilisateur, creerPremierAdministrateur } from './comptes'

let avec = ''
let sans = ''

beforeAll(async () => {
  const a = await prisma.user.create({
    data: {
      email: 'comptes-avec@test.local',
      name: 'A',
      passwordHash: await hashPassword('secret'),
      role: 'CONSULTANT',
    },
  })
  const b = await prisma.user.create({
    data: { email: 'comptes-sans@test.local', name: 'B', passwordHash: '', role: 'CONSULTANT' },
  })
  avec = a.id
  sans = b.id
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'comptes-' } } })
  await prisma.$disconnect()
})

describe('aUnMotDePasse', () => {
  it('reconnaît un compte qui en porte un', async () => {
    expect(await aUnMotDePasse(avec)).toBe(true)
  })

  // L'empreinte vide est l'état des comptes nés de la reprise Dolibarr et de la
  // connexion Google : ils existent, mais la porte mot de passe leur est fermée
  // tant qu'ils n'en ont pas défini un.
  it("refuse l'empreinte vide, qui n'est pas un mot de passe", async () => {
    expect(await aUnMotDePasse(sans)).toBe(false)
  })

  it('refuse un compte qui n existe pas', async () => {
    expect(await aUnMotDePasse('inexistant')).toBe(false)
  })
})

describe('le premier administrateur', () => {
  it("n'est proposé que sur une base sans aucun utilisateur", async () => {
    // Les comptes du décor existent : la fenêtre est fermée.
    expect(await aucunUtilisateur()).toBe(false)
  })

  it('refuse dès qu un compte existe, même si l écran l a proposé', async () => {
    const r = await creerPremierAdministrateur({
      email: 'intrus@test.local',
      name: 'Intrus',
      motDePasse: 'un-tres-bon-secret',
    })

    expect(r.ok).toBe(false)
    expect(await prisma.user.count({ where: { email: 'intrus@test.local' } })).toBe(0)
  })

  // Cet écran est la seule porte d'une instance neuve, et il est joignable
  // depuis Internet dès que l'installation l'est. Un mot de passe court y
  // serait la faille la plus banale qui soit.
  it('refuse un mot de passe trop court, sans rien créer', async () => {
    const r = await creerPremierAdministrateur({
      email: 'court@test.local',
      name: 'Court',
      motDePasse: 'court',
    })

    expect(r.ok).toBe(false)
    expect(r.motif).toMatch(/12/)
    expect(await prisma.user.count({ where: { email: 'court@test.local' } })).toBe(0)
  })
})

