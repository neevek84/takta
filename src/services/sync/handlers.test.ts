import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { saveInstanceCredential } from '@/services/credentials'
import { DOLIBARR } from '@/services/dolibarr/api'
import { FakeDolibarr } from '@/services/dolibarr/fake'

// Seul l'accès réseau est doublé : `getDolibarrApi` reste le vrai, et lit
// réellement la clé d'instance. Doubler `getDolibarrApi` lui-même laisserait
// passer un câblage qui ne sait pas relire les identifiants.
const { createHttpDolibarrApi } = vi.hoisted(() => ({ createHttpDolibarrApi: vi.fn() }))
vi.mock('@/services/dolibarr/http', () => ({ createHttpDolibarrApi }))

import { buildSyncHandlers } from './handlers'

let api: FakeDolibarr

beforeAll(() => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
})

beforeEach(async () => {
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  api = new FakeDolibarr()
  createHttpDolibarrApi.mockReset().mockReturnValue(api)
})

afterAll(async () => {
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.$disconnect()
})

async function connecterDolibarr(): Promise<void> {
  await saveInstanceCredential({
    provider: DOLIBARR,
    secret: 'cle-de-test',
    baseUrl: 'https://dolibarr.invalid/api/index.php',
    metadata: { dolibarrUserId: '7' },
  })
}

describe('buildSyncHandlers', () => {
  /**
   * Une installation sans aucun connecteur est le cas nominal, pas un incident :
   * l'application est autoportante. Rendre un gestionnaire par défaut ferait
   * tomber en échec des lignes qu'aucune clé d'API n'a jamais pu pousser.
   */
  it('ne rend aucun gestionnaire quand aucun fournisseur n est connecté', async () => {
    expect(await buildSyncHandlers()).toEqual({})
  })

  it('inscrit le gestionnaire Dolibarr sous la clé du fournisseur', async () => {
    await connecterDolibarr()

    const handlers = await buildSyncHandlers()

    // La clé est celle qu'écrit la mise en file (`services/cra.ts`). Une clé
    // qui diverge ne lève rien : la ligne reste en attente pour toujours.
    expect(Object.keys(handlers)).toEqual([DOLIBARR])
    expect(typeof handlers[DOLIBARR]?.upsert).toBe('function')
    expect(typeof handlers[DOLIBARR]?.remove).toBe('function')
  })

  it('n inscrit rien quand la clé d instance n a pas d URL', async () => {
    await saveInstanceCredential({
      provider: DOLIBARR,
      secret: 'cle-de-test',
      baseUrl: '',
      metadata: {},
    })

    expect(await buildSyncHandlers()).toEqual({})
  })
})
