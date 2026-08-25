import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { definirVueParDefaut, vueParDefautDe } from './vue-par-defaut'

let userId = ''

async function decor(): Promise<void> {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'vue-defaut-' } } })
  const u = await prisma.user.create({
    data: {
      email: 'vue-defaut-a@test.local',
      name: 'Porteur',
      passwordHash: '',
      role: 'CONSULTANT',
    },
  })
  userId = u.id
}

beforeEach(decor)

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'vue-defaut-' } } })
  await prisma.$disconnect()
})

describe('vueParDefautDe', () => {
  it("rend null quand rien n'est réglé", async () => {
    expect(await vueParDefautDe(userId)).toBeNull()
  })

  it('rend la vue qui a été définie', async () => {
    await definirVueParDefaut(userId, 'TABLEAU')
    expect(await vueParDefautDe(userId)).toBe('TABLEAU')
  })

  // Une colonne texte libre peut porter n'importe quoi si elle est un jour
  // modifiée hors de ce service (migration manuelle, ancienne valeur) — la
  // lecture ne doit jamais renvoyer une chaîne que `SaisieClient` ne
  // reconnaîtrait pas.
  it("rend null pour une valeur en base qui n'est pas une vue reconnue", async () => {
    await prisma.user.update({ where: { id: userId }, data: { defaultVue: 'AUTRE' } })
    expect(await vueParDefautDe(userId)).toBeNull()
  })
})

describe('definirVueParDefaut', () => {
  it('remplace un réglage précédent', async () => {
    await definirVueParDefaut(userId, 'TROIS_MOIS')
    await definirVueParDefaut(userId, 'CALENDRIER')
    expect(await vueParDefautDe(userId)).toBe('CALENDRIER')
  })

  // Ce que règle un compte ne doit jamais se voir chez un autre — même défaut
  // de portée que celui documenté dans `services/dolibarr/utilisateur.ts`.
  it('ne touche que le compte visé', async () => {
    const autre = await prisma.user.create({
      data: { email: 'vue-defaut-b@test.local', name: 'B', passwordHash: '', role: 'CONSULTANT' },
    })

    await definirVueParDefaut(userId, 'TABLEAU')

    expect(await vueParDefautDe(autre.id)).toBeNull()
  })
})
