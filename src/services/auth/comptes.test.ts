import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { hashPassword } from '@/auth-password'
import { DOLIBARR } from '@/services/dolibarr/api'
import { LIEN_UTILISATEUR } from '@/services/dolibarr/liens'
import {
  aUnMotDePasse,
  aucunUtilisateur,
  creerPremierAdministrateur,
  definirActivation,
  definirRole,
  listerComptes,
} from './comptes'

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


/**
 * Le décor de l'administration des comptes est **refait à chaque test** : la
 * plupart d'entre eux rétrogradent ou désactivent, et un décor monté une seule
 * fois ferait dépendre chaque cas de l'ordre des précédents.
 */
describe('administration des comptes', () => {
  let patron = ''
  let second = ''
  let simple = ''

  beforeEach(async () => {
    // Les correspondances Dolibarr partent avant les comptes qu'elles
    // désignent : `ExternalLink` ne porte pas de clé étrangère vers `User`, et
    // une correspondance orpheline ferait apparaître un n° Dolibarr sur le
    // compte suivant qui hériterait de son identifiant.
    const anciens = await prisma.user.findMany({
      where: { email: { startsWith: 'roles-' } },
      select: { id: true },
    })
    await prisma.externalLink.deleteMany({
      where: { entityType: LIEN_UTILISATEUR, entityId: { in: anciens.map((u) => u.id) } },
    })
    await prisma.user.deleteMany({ where: { email: { startsWith: 'roles-' } } })
    const a = await prisma.user.create({
      data: { email: 'roles-patron@test.local', name: 'Patron', passwordHash: '', role: 'ADMIN' },
    })
    const b = await prisma.user.create({
      data: { email: 'roles-second@test.local', name: 'Second', passwordHash: '', role: 'ADMIN' },
    })
    const c = await prisma.user.create({
      data: {
        email: 'roles-simple@test.local',
        name: 'Simple',
        passwordHash: '',
        role: 'CONSULTANT',
      },
    })
    patron = a.id
    second = b.id
    simple = c.id
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'roles-' } } })
  })

  describe('listerComptes', () => {
    it('rend les comptes avec leur rôle et leur activation', async () => {
      const comptes = await listerComptes()
      const vue = comptes.find((c) => c.id === simple)

      expect(vue).toMatchObject({ name: 'Simple', role: 'CONSULTANT', disabled: false })
    })

    // L'écran ne montre que ce qu'un administrateur a besoin de voir. L'empreinte
    // de mot de passe n'en fait pas partie, et une vue qui la porterait finirait
    // par la peindre.
    it('ne rend aucune empreinte de mot de passe', async () => {
      const comptes = await listerComptes()
      expect(JSON.stringify(comptes)).not.toContain('passwordHash')
    })

    // Un compte sans utilisateur Dolibarr ne peut rien pousser : le push refuse
    // plutôt que de retomber sur celui d'un autre. C'est donc l'écran des
    // comptes qui doit le montrer d'un coup d'œil, sinon la panne ne se
    // découvre qu'au premier envoi.
    it('rend l identifiant Dolibarr de qui en a un, et null pour les autres', async () => {
      await prisma.externalLink.create({
        data: {
          // `userId` est **celui qui a posé** la correspondance, `entityId`
          // celui qu'elle désigne : la reprise des temps les distingue, et
          // c'est `entityId` que `identifiantDolibarrDe` interroge.
          userId: patron,
          entityType: LIEN_UTILISATEUR,
          entityId: simple,
          provider: DOLIBARR,
          externalId: '42',
        },
      })

      const comptes = await listerComptes()

      expect(comptes.find((c) => c.id === simple)?.identifiantDolibarr).toBe(42)
      expect(comptes.find((c) => c.id === patron)?.identifiantDolibarr).toBeNull()
    })
  })

  describe('definirRole', () => {
    it('élève un consultant', async () => {
      const r = await definirRole({ userId: simple, role: 'ADMIN', parId: patron })

      expect(r.ok).toBe(true)
      expect((await prisma.user.findUniqueOrThrow({ where: { id: simple } })).role).toBe('ADMIN')
    })

    // Se retirer soi-même le rôle est le geste qui mure l'instance : plus personne
    // pour le rendre, et aucun écran pour rouvrir.
    it('refuse de se retirer son propre rôle', async () => {
      const r = await definirRole({ userId: patron, role: 'CONSULTANT', parId: patron })

      expect(r.ok).toBe(false)
      expect((await prisma.user.findUniqueOrThrow({ where: { id: patron } })).role).toBe('ADMIN')
    })

    it('accepte de rétrograder un autre administrateur, tant qu il en reste un', async () => {
      const r = await definirRole({ userId: second, role: 'CONSULTANT', parId: patron })

      expect(r.ok).toBe(true)
    })

    it('refuse de retirer le dernier administrateur', async () => {
      await definirRole({ userId: second, role: 'CONSULTANT', parId: patron })
      // `patron` est désormais seul. Il ne peut pas non plus être rétrogradé par
      // lui-même — mais la règle vaut aussi de la part d'un autre.
      const r = await definirRole({ userId: patron, role: 'CONSULTANT', parId: second })

      expect(r.ok).toBe(false)
      expect(r.motif).toMatch(/dernier administrateur/i)
    })

    it('refuse un rôle inventé', async () => {
      const r = await definirRole({
        userId: simple,
        role: 'ROOT' as unknown as 'ADMIN',
        parId: patron,
      })

      expect(r.ok).toBe(false)
    })
  })

  describe('definirActivation', () => {
    it('coupe un accès sans rien détruire', async () => {
      const r = await definirActivation({ userId: simple, actif: false, parId: patron })

      expect(r.ok).toBe(true)
      const apres = await prisma.user.findUniqueOrThrow({ where: { id: simple } })
      expect(apres.disabled).toBe(true)
      expect(apres.email).toBe('roles-simple@test.local')
    })

    it('rouvre un accès coupé', async () => {
      await definirActivation({ userId: simple, actif: false, parId: patron })
      await definirActivation({ userId: simple, actif: true, parId: patron })

      expect((await prisma.user.findUniqueOrThrow({ where: { id: simple } })).disabled).toBe(false)
    })

    // Se désactiver soi-même, c'est se mettre dehors et jeter la clé.
    it('refuse de se désactiver soi-même', async () => {
      const r = await definirActivation({ userId: patron, actif: false, parId: patron })

      expect(r.ok).toBe(false)
      expect((await prisma.user.findUniqueOrThrow({ where: { id: patron } })).disabled).toBe(false)
    })

    it('refuse de désactiver le dernier administrateur', async () => {
      await definirRole({ userId: second, role: 'CONSULTANT', parId: patron })

      const r = await definirActivation({ userId: patron, actif: false, parId: second })

      expect(r.ok).toBe(false)
    })
  })
})
