import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { syncJobDefinitions } from './jobs/scheduler'
import { listAlertes, readOrdonnanceur } from './supervision'

let userId = ''

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'supervision@test.local', name: 'K', passwordHash: 'x' } })
  ).id
})

beforeEach(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await syncJobDefinitions()
})

afterAll(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.scheduledJob.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { startsWith: 'supervision' } } })
  await prisma.$disconnect()
})

async function abonnement(patch: Record<string, unknown> = {}) {
  return prisma.webhook.create({
    data: {
      userId, label: 'n8n', url: 'https://exemple.test/hook', secret: 's', ...patch,
    },
  })
}

describe('alertes', () => {
  it('ne dit rien quand rien ne cloche', async () => {
    expect(await listAlertes(userId)).toEqual([])
  })

  it('signale un travail en échec, avec sa dernière erreur', async () => {
    await prisma.scheduledJob.update({
      where: { name: 'webhooks.distribute' },
      data: { lastState: 'ECHEC', lastError: 'URL injoignable' },
    })

    const alertes = await listAlertes(userId)
    expect(alertes).toHaveLength(1)
    expect(alertes[0]).toMatchObject({ code: 'TRAVAIL_ECHEC' })
    expect(alertes[0]!.detail).toContain('URL injoignable')
    expect(alertes[0]!.libelle).toContain('Distribution des rappels sortants')
  })

  it('ne signale pas un travail simplement indisponible', async () => {
    // « Pas de notification pour ce qui n appelle aucune action » : un lot
    // non encore livré n'est pas une panne.
    await prisma.scheduledJob.update({
      where: { name: 'signature.relance' },
      data: { lastState: 'INDISPONIBLE' },
    })
    expect(await listAlertes(userId)).toEqual([])
  })

  it('signale un abonnement suspendu', async () => {
    await abonnement({ state: 'SUSPENDU', consecutiveFailures: 12, lastError: 'ECONNREFUSED' })

    const alertes = await listAlertes(userId)
    expect(alertes[0]).toMatchObject({ code: 'ABONNEMENT_SUSPENDU' })
    expect(alertes[0]!.libelle).toContain('n8n')
    expect(alertes[0]!.detail).toContain('ECONNREFUSED')
  })

  it('DONNE LE SEQ DE RATTRAPAGE d un abonnement suspendu', async () => {
    // La réactivation repart de l'instant présent : sans ce numéro affiché
    // **avant** de réactiver, les événements de la période suspendue sont
    // irrattrapables — on ne sait plus depuis où relire.
    await abonnement({ state: 'SUSPENDU', lastSeq: 4217, lastError: 'x' })

    const alertes = await listAlertes(userId)
    expect(alertes[0]!.detail).toContain('since=4217')
  })

  it('signale les livraisons abandonnées, groupées', async () => {
    const w = await abonnement()
    for (const seq of [1, 2, 3]) {
      await prisma.webhookDelivery.create({
        data: { webhookId: w.id, seq, action: 'cra.valide', state: 'ABANDONNE', attempts: 5 },
      })
    }

    const alertes = await listAlertes(userId)
    const abandon = alertes.find((a) => a.code === 'LIVRAISON_ABANDONNEE')
    expect(abandon).toBeDefined()
    expect(abandon!.detail).toContain('3')
    expect(abandon!.libelle).toContain('n8n')
  })

  it('SIGNALE UNE RUPTURE DE CHAÎNE, avec l entrée en cause', async () => {
    for (let i = 1; i <= 3; i++) {
      await appendAudit({
        ...ACTEUR_SYSTEME, action: 'cra.valide', entityType: 'Cra', entityId: `c${i}`, payload: {},
      })
    }
    await prisma.auditEvent.update({ where: { seq: 2 }, data: { payloadJson: '{"x":1}' } })

    const alertes = await listAlertes(userId)
    const rupture = alertes.find((a) => a.code === 'JOURNAL_ROMPU')
    expect(rupture).toBeDefined()
    expect(rupture!.detail).toContain('2')
    expect(rupture!.detail).toContain('EMPREINTE')
  })

  it('place la rupture de chaîne en tête', async () => {
    await abonnement({ state: 'SUSPENDU', lastError: 'x' })
    for (let i = 1; i <= 2; i++) {
      await appendAudit({
        ...ACTEUR_SYSTEME, action: 'cra.valide', entityType: 'Cra', entityId: `c${i}`, payload: {},
      })
    }
    await prisma.auditEvent.update({ where: { seq: 1 }, data: { payloadJson: '{"x":1}' } })

    expect((await listAlertes(userId))[0]!.code).toBe('JOURNAL_ROMPU')
  })

  it('isole par utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'supervision-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    await prisma.webhook.create({
      data: { userId: autre.id, label: 'ailleurs', url: 'https://x.test/h', secret: 's', state: 'SUSPENDU' },
    })

    expect(await listAlertes(userId)).toEqual([])
    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('isole les livraisons abandonnées par utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'supervision-autre@test.local', name: 'A', passwordHash: 'x' },
    })
    const w = await prisma.webhook.create({
      data: { userId: autre.id, label: 'ailleurs', url: 'https://x.test/h', secret: 's' },
    })
    await prisma.webhookDelivery.create({
      data: { webhookId: w.id, seq: 1, action: 'cra.valide', state: 'ABANDONNE', attempts: 5 },
    })

    expect(await listAlertes(userId)).toEqual([])
    await prisma.user.delete({ where: { id: autre.id } })
  })
})

/**
 * Les travaux de fond tournent pour **un seul** compte, le plus ancien. Un
 * second consultant ne recevrait aucun rappel, et rien ne le lui dirait : cet
 * agrégat est le seul endroit d'où l'écran peut le dire.
 */
describe('ordonnanceur', () => {
  it('NOMME LE COMPTE POUR LEQUEL LES TRAVAUX TOURNENT, et prévient le second', async () => {
    // Datés dans un passé lointain : ces deux comptes sont les plus anciens de
    // la base de test, quels que soient les comptes laissés par les autres
    // fichiers de test.
    const premier = await prisma.user.create({
      data: {
        email: 'supervision-premier@test.local',
        name: 'Premier',
        passwordHash: 'x',
        createdAt: new Date('2000-01-01T00:00:00.000Z'),
      },
    })
    const second = await prisma.user.create({
      data: {
        email: 'supervision-second@test.local',
        name: 'Second',
        passwordHash: 'x',
        createdAt: new Date('2001-01-01T00:00:00.000Z'),
      },
    })

    const vueDuSecond = await readOrdonnanceur(second.id)
    expect(vueDuSecond.proprietaireLabel).toBe('Premier')
    expect(vueDuSecond.autreCompte).toBe(true)
    expect(vueDuSecond.comptes).toBeGreaterThanOrEqual(2)

    const vueDuPremier = await readOrdonnanceur(premier.id)
    expect(vueDuPremier.proprietaireLabel).toBe('Premier')
    expect(vueDuPremier.autreCompte).toBe(false)

    await prisma.user.deleteMany({
      where: { id: { in: [premier.id, second.id] } },
    })
  })
})
