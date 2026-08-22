import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { hashPassword } from '@/auth-password'
import { aUnMotDePasse } from './comptes'

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
