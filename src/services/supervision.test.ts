import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { createClient } from '@/services/clients'
import { createMission } from '@/services/missions'
import { syncJobDefinitions } from './jobs/scheduler'
import { listAlertes, readOrdonnanceur } from './supervision'

let userId = ''
let missionId = ''

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'supervision@test.local', name: 'K', passwordHash: 'x' } })
  ).id
  const c = await createClient('SUPERVISION client', null, userId)
  missionId = (await createMission({ clientId: c.id, label: 'M', userId })).id
})

beforeEach(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.scheduledJob.deleteMany({})
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.auditEvent.deleteMany({})
  await syncJobDefinitions()
})

afterAll(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.scheduledJob.deleteMany({})
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({ where: { email: { startsWith: 'supervision' } } })
  await prisma.client.deleteMany({ where: { name: 'SUPERVISION client' } })
  await prisma.$disconnect()
})

/** Un CRA envoyé dont la demande de signature est dans l'état demandé. */
async function craEnSouffrance(demande: Record<string, unknown>): Promise<string> {
  const cra = await prisma.cra.create({
    data: {
      userId,
      missionId,
      month: new Date('2026-06-01T00:00:00.000Z'),
      status: 'ENVOYE',
    },
  })
  await prisma.signatureRequest.create({
    data: { craId: cra.id, provider: 'double', status: 'EN_ATTENTE', ...demande },
  })
  return cra.id
}

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

  it('SIGNALE LES CRA EN SOUFFRANCE DE SIGNATURE', async () => {
    // L'alerte que le lot 3 devait ajouter à l'union : sans elle, l'écran
    // vers lequel le produit dirige l'utilisateur pour savoir « ce qui demande
    // une action » annonce « rien ne demande d'action » alors que des CRA
    // attendent une reprise à la main.
    const craId = await craEnSouffrance({ abandoned: true, status: 'EN_ATTENTE' })

    const alertes = await listAlertes(userId)
    const souffrance = alertes.find((a) => a.code === 'CRA_SOUFFRANCE_SIGNATURE')
    expect(souffrance, 'aucune alerte de CRA en souffrance').toBeDefined()
    expect(souffrance!.detail).toContain('SUPERVISION client')
    expect(souffrance!.detail).toContain('2026-06')

    await prisma.cra.delete({ where: { id: craId } })
  })

  it('signale aussi une demande expirée, qu aucune relance ne reprendra', async () => {
    const craId = await craEnSouffrance({ status: 'EXPIRE' })

    expect((await listAlertes(userId)).map((a) => a.code)).toContain('CRA_SOUFFRANCE_SIGNATURE')

    await prisma.cra.delete({ where: { id: craId } })
  })

  it('n alerte pas sur un CRA dont la signature suit son cours', async () => {
    const craId = await craEnSouffrance({ status: 'EN_ATTENTE', abandoned: false })
    expect(await listAlertes(userId)).toEqual([])
    await prisma.cra.delete({ where: { id: craId } })
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
  it('NOMME LE COMPTE QUI PORTE LES TRAVAUX D INSTANCE', async () => {
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

    // Le propriétaire ne désigne plus que les travaux d'instance — la file,
    // les webhooks, la chaîne du journal. Les deux rappels, eux, passent par
    // compte actif : c'est l'ordonnanceur qui le prouve, pas cet écran.
    const vueDuSecond = await readOrdonnanceur(second.id)
    expect(vueDuSecond.proprietaireLabel).toBe('Premier')
    expect(vueDuSecond.comptes).toBeGreaterThanOrEqual(2)

    const vueDuPremier = await readOrdonnanceur(premier.id)
    expect(vueDuPremier.proprietaireLabel).toBe('Premier')

    await prisma.user.deleteMany({
      where: { id: { in: [premier.id, second.id] } },
    })
  })
})
