import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { ENTITY_CRA, PROVIDER_GOOGLE } from '@/core/sync/policy'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { updateSettings } from '@/services/settings'
import { saveInstanceCredential } from '@/services/credentials'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { DOLIBARR } from '@/services/dolibarr/api'
import { FakeDolibarr } from '@/services/dolibarr/fake'
import { enqueueSync } from './outbox'

// Seul l'accès réseau est doublé. Tout le reste de la chaîne est le vrai :
// validation du CRA, mise en file, construction des gestionnaires, drainage,
// push. C'est la chaîne complète qui était rompue, pas une de ses pièces.
const { createHttpDolibarrApi } = vi.hoisted(() => ({ createHttpDolibarrApi: vi.fn() }))
vi.mock('@/services/dolibarr/http', () => ({ createHttpDolibarrApi }))

import { drainProvidersForUser, flushAllProviders } from './drain'

let userId = ''
let autreId = ''
let missionId = ''
let lineId = ''
let api: FakeDolibarr

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  userId = (
    await prisma.user.create({
      data: { email: 'drain@test.local', name: 'T', passwordHash: 'x' },
    })
  ).id
  autreId = (
    await prisma.user.create({
      data: { email: 'drain-autre@test.local', name: 'A', passwordHash: 'x' },
    })
  ).id

  const c = await createClient('DRAIN client')
  const m = await createMission({ clientId: c.id, label: 'DRAIN mission' })
  missionId = m.id
  lineId = (
    await createLine({
      missionId,
      userId,
      label: 'Développement',
      soldCentiemes: 3000,
      tjmCents: 80_000,
    })
  ).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await prisma.syncOutbox.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })

  api = new FakeDolibarr()
  const projet = api.seedProject({ ref: 'PJ001', title: 'DRAIN mission', socid: 1 })
  createHttpDolibarrApi.mockReset().mockReturnValue(api)

  await saveInstanceCredential({
    provider: DOLIBARR,
    secret: 'cle-de-test',
    baseUrl: 'https://dolibarr.invalid/api/index.php',
    metadata: { dolibarrUserId: '7' },
  })
  await prisma.externalLink.create({
    data: {
      userId,
      entityType: 'Mission',
      entityId: missionId,
      provider: DOLIBARR,
      externalId: String(projet.id),
    },
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await prisma.syncOutbox.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['drain@test.local', 'drain-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'DRAIN client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

/** Un mois saisi, envoyé et validé : exactement ce que fait le consultant. */
async function craValide(month: string, date: string): Promise<string> {
  await saveEntry({ userId, lineId, date, minutes: 480, kind: 'REALISE' })
  const cra = await getOrCreateCra(userId, missionId, month)
  await transitionCra(userId, cra.id, 'ENVOYER')
  await transitionCra(userId, cra.id, 'VALIDER')
  return cra.id
}

/** Une ligne de file dont la cible n'existe plus : consommée sans rien pousser. */
async function fileFantome(pour: string, combien: number): Promise<void> {
  for (let i = 0; i < combien; i++) {
    await prisma.$transaction(async (tx) => {
      await enqueueSync(tx, {
        userId: pour,
        entityType: ENTITY_CRA,
        entityId: `fantome-${pour}-${i}`,
        provider: DOLIBARR,
      })
    })
  }
}

/**
 * Le défaut que ce module referme.
 *
 * La validation d'un CRA met bien ses temps en file (tâche 8), et le
 * gestionnaire sait les pousser (tâche 7) — mais les deux points d'entrée du
 * drainage, le bouton et l'endpoint, ne filtraient que `PROVIDER_GOOGLE`.
 * Aucun des deux n'appelait `flushOutbox` : la ligne Dolibarr s'empilait pour
 * toujours, sans erreur et sans message.
 *
 * Ces tests tombent si l'on retire Dolibarr du drainage.
 */
describe('le bouton « Synchroniser maintenant »', () => {
  it('un CRA validé part réellement chez Dolibarr', async () => {
    await craValide('2026-05', '2026-05-04')
    expect(await prisma.syncOutbox.count({ where: { userId, provider: DOLIBARR } })).toBe(1)

    const rapport = await drainProvidersForUser({ userId })

    expect(api.timespents).toHaveLength(1)
    expect(api.timespents[0]?.durationSeconds).toBe(480 * 60)
    expect(rapport.traitees).toBe(1)
    expect(rapport.reussies).toBe(1)
    // La ligne est consommée : la file ne repoussera pas les mêmes temps.
    expect(await prisma.syncOutbox.count({ where: { userId, provider: DOLIBARR } })).toBe(0)
  })

  /**
   * Le drainage de l'agenda prenait autrefois les lignes Dolibarr pour des
   * saisies disparues et les supprimait. Ajouter un fournisseur ne doit pas
   * rouvrir la fuite dans l'autre sens : la ligne d'agenda reste intacte.
   */
  it('ne consomme pas les lignes de l agenda au passage', async () => {
    await craValide('2026-05', '2026-05-04')

    await drainProvidersForUser({ userId })

    const agenda = await prisma.syncOutbox.findFirstOrThrow({
      where: { userId, provider: PROVIDER_GOOGLE },
    })
    expect(agenda.state).toBe('PENDING')
    expect(agenda.attempts).toBe(0)
  })

  /**
   * `nonConnecte` porte le message « aucun connecteur joignable ». Le laisser
   * décidé par le seul agenda annoncerait une file intacte alors que Dolibarr,
   * lui, vient de recevoir les temps.
   */
  it('ne se déclare pas sans connecteur quand Dolibarr, lui, répond', async () => {
    await craValide('2026-05', '2026-05-04')

    expect((await drainProvidersForUser({ userId })).nonConnecte).toBe(false)
  })

  it('se déclare sans connecteur quand rien n est configuré', async () => {
    await prisma.providerCredential.deleteMany({})
    await craValide('2026-05', '2026-05-04')

    const rapport = await drainProvidersForUser({ userId })

    expect(rapport.nonConnecte).toBe(true)
    expect(rapport.traitees).toBe(0)
  })

  /**
   * Un fournisseur sans gestionnaire n'est pas un fournisseur en panne : ses
   * lignes attendent la clé d'API au lieu de consommer leur quota.
   */
  it('laisse la file en attente quand Dolibarr n est pas connecté', async () => {
    // Mise en file pendant que la clé existe, puis clé retirée : c'est la
    // situation d'un identifiant révoqué, pas celle d'un CRA jamais armé.
    await craValide('2026-05', '2026-05-04')
    await prisma.providerCredential.deleteMany({})

    await drainProvidersForUser({ userId })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({
      where: { userId, provider: DOLIBARR },
    })
    expect(ligne.state).toBe('PENDING')
    expect(ligne.attempts).toBe(0)
  })

  // Le bouton enchaîne les passes : s'arrêter au lot rendrait un compte rendu
  // indiscernable d'une file vidée. La propriété vaut pour tous les
  // fournisseurs, pas seulement pour l'agenda.
  it('enchaîne les passes au lieu de s arrêter à la taille du lot', async () => {
    await fileFantome(userId, 3)

    const rapport = await drainProvidersForUser({ userId, limit: 1 })

    expect(rapport.traitees).toBe(3)
    expect(rapport.reste).toBe(0)
    expect(await prisma.syncOutbox.count({ where: { userId, provider: DOLIBARR } })).toBe(0)
  })

  it('annonce ce qui reste quand les passes sont épuisées', async () => {
    await fileFantome(userId, 3)

    const rapport = await drainProvidersForUser({ userId, limit: 1, maxPasses: 1 })

    expect(rapport.traitees).toBe(1)
    expect(rapport.reste).toBe(2)
  })
})

/**
 * Le déclenchement externe n'a pas de session : il énumère les comptes.
 *
 * La clé d'API Dolibarr est de portée instance, donc aucun `ProviderCredential`
 * personnel ne désigne les comptes à drainer — c'est la file elle-même qui les
 * porte. Énumérer les comptes d'agenda, comme le fait le drainage Google,
 * laisserait dehors tout consultant qui n'a jamais connecté Google.
 */
describe('le déclenchement externe', () => {
  it('pousse le CRA d un compte qui n a aucun agenda connecté', async () => {
    await craValide('2026-05', '2026-05-04')

    const rapport = await flushAllProviders()

    expect(api.timespents).toHaveLength(1)
    expect(rapport.comptesFile).toBe(1)
    expect(rapport.traiteesFile).toBe(1)
    expect(rapport.reussiesFile).toBe(1)
    expect(rapport.resteFile).toBe(0)
    expect(await prisma.syncOutbox.count({ where: { provider: DOLIBARR } })).toBe(0)
  })

  it('draine chaque compte en attente, pas seulement le premier', async () => {
    await fileFantome(userId, 1)
    await fileFantome(autreId, 1)

    const rapport = await flushAllProviders()

    expect(rapport.comptesFile).toBe(2)
    expect(rapport.traiteesFile).toBe(2)
  })

  it('ne draine rien quand aucun fournisseur n est connecté', async () => {
    await prisma.providerCredential.deleteMany({})
    await fileFantome(userId, 1)

    const rapport = await flushAllProviders()

    expect(rapport.comptesFile).toBe(0)
    expect(rapport.traiteesFile).toBe(0)
    expect((await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })).state).toBe('PENDING')
  })
})
