import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { hashPassword, verifyPassword } from './auth-password'
import { prisma } from '@/db/client'

// `requireUser` lit la session via le `auth()` produit par NextAuth au moment
// de l'import du module. On remplace donc NextAuth lui-même : le test pilote
// la session, la base reste réelle — c'est justement l'écart entre les deux
// que la fonction doit détecter.
const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }))

vi.mock('next-auth', () => ({
  default: vi.fn(() => ({
    handlers: {},
    auth: authMock,
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}))
vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn(() => ({ id: 'credentials' })),
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { requireUser } from './auth'

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

describe('requireUser', () => {
  let userId = ''

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email: 'require-user@test.local', name: 'R', passwordHash: 'x', role: 'ADMIN' },
    })
    userId = u.id
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'require-user@test.local' } })
    await prisma.$disconnect()
  })

  it('refuse une requête sans session', async () => {
    authMock.mockResolvedValue(null)
    await expect(requireUser()).rejects.toThrow('Non authentifié')
  })

  it('refuse une session sans identifiant', async () => {
    authMock.mockResolvedValue({ user: { email: 'x@test.local' } })
    await expect(requireUser()).rejects.toThrow('Non authentifié')
  })

  // Le défaut observé en usage réel : après recréation de la table `User`, le
  // jeton porte un identifiant qui n'existe plus. Sans vérification, la page
  // s'affiche et la première écriture touchant une clé étrangère plante
  // (`Foreign key constraint violated` dans `assignment.create`). Une session
  // dont l'utilisateur a disparu doit être rejetée à l'authentification.
  it("refuse une session dont l'utilisateur n'existe plus en base", async () => {
    authMock.mockResolvedValue({ user: { id: 'utilisateur-supprime', role: 'ADMIN' } })
    await expect(requireUser()).rejects.toThrow('Non authentifié')
  })

  it("rend l'utilisateur existant, avec le rôle lu en base", async () => {
    // Rôle périmé dans le jeton : la base fait foi.
    authMock.mockResolvedValue({ user: { id: userId, role: 'CONSULTANT' } })
    expect(await requireUser()).toEqual({ id: userId, role: 'ADMIN' })
  })
})

describe('un compte désactivé n a plus de session', () => {
  // Un jeton signé survit à la désactivation : il ne prouve que sa propre
  // signature. Sans cette relecture, couper un accès ne couperait rien avant
  // l'expiration du jeton — c'est-à-dire trente jours, par défaut.
  it('refuse la session d un compte désactivé', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'desactive@test.local',
        name: 'Coupé',
        passwordHash: '',
        role: 'CONSULTANT',
        disabled: true,
      },
    })
    authMock.mockResolvedValue({ user: { id: u.id } })

    await expect(requireUser()).rejects.toThrow('Non authentifié')

    await prisma.user.delete({ where: { id: u.id } })
  })

  it('laisse entrer un compte actif', async () => {
    const u = await prisma.user.create({
      data: { email: 'actif@test.local', name: 'Actif', passwordHash: '', role: 'CONSULTANT' },
    })
    authMock.mockResolvedValue({ user: { id: u.id } })

    await expect(requireUser()).resolves.toEqual({ id: u.id, role: 'CONSULTANT' })

    await prisma.user.delete({ where: { id: u.id } })
  })
})
