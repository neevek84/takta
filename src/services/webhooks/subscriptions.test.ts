import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import type { AuditAction } from '@/core/audit/events'
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  getWebhookSecret,
  listWebhooks,
  readSeuilSuspension,
  updateWebhook,
  WebhookValidationError,
} from './subscriptions'

let userId = ''
let autreId = ''

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { email: 'hook@test.local', name: 'K', passwordHash: 'x' } })
  ).id
  autreId = (
    await prisma.user.create({
      data: { email: 'hook-autre@test.local', name: 'A', passwordHash: 'x' },
    })
  ).id
})

beforeEach(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.webhook.deleteMany({})
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['hook@test.local', 'hook-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

const BASE = { label: 'n8n', url: 'https://exemple.test/hook', events: [] as AuditAction[] }

describe('création d un abonnement', () => {
  it('engendre un secret quand on n en fournit pas', async () => {
    const w = await createWebhook(userId, BASE)
    const brut = await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })
    expect(brut.secret).toMatch(/^[0-9a-f]{64}$/)
  })

  it('ne rend jamais le secret', async () => {
    const w = await createWebhook(userId, { ...BASE, secret: 'mon-secret' })
    expect(JSON.stringify(w)).not.toContain('mon-secret')
    expect(Object.keys(w)).not.toContain('secret')
  })

  it('REFUSE UN SECRET VIDE plutôt que d ouvrir le point d entrée', async () => {
    // Un abonnement sans secret signerait avec une chaîne vide : n'importe
    // qui connaissant l'URL pourrait alors fabriquer un événement crédible.
    await expect(createWebhook(userId, { ...BASE, secret: '' })).rejects.toBeInstanceOf(
      WebhookValidationError,
    )
    await expect(createWebhook(userId, { ...BASE, secret: '   ' })).rejects.toBeInstanceOf(
      WebhookValidationError,
    )
    expect(await prisma.webhook.count()).toBe(0)
  })

  it('persiste les événements en chaîne, pas en tableau', async () => {
    const w = await createWebhook(userId, { ...BASE, events: ['cra.valide', 'saisie.creee'] })
    const brut = await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })
    expect(brut.events).toBe('cra.valide,saisie.creee')
    expect(w.events).toEqual(['cra.valide', 'saisie.creee'])
  })

  it('traite la liste vide comme « tous les événements »', async () => {
    const w = await createWebhook(userId, BASE)
    expect(w.events).toEqual([])
    const brut = await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })
    expect(brut.events).toBe('')
  })

  it('démarre actif et au sommet du journal', async () => {
    await appendAudit({
      ...ACTEUR_SYSTEME,
      action: 'cra.valide',
      entityType: 'Cra',
      entityId: 'c1',
      payload: {},
    })
    const w = await createWebhook(userId, BASE)
    expect(w.state).toBe('ACTIF')
    // Un abonnement neuf ne rejoue pas l'histoire : il part de maintenant.
    expect(w.lastSeq).toBe(1)
  })

  it('refuse une URL qui n est pas http(s)', async () => {
    for (const url of ['', 'ftp://exemple.test', 'exemple.test/hook', 'javascript:alert(1)']) {
      await expect(createWebhook(userId, { ...BASE, url })).rejects.toBeInstanceOf(
        WebhookValidationError,
      )
    }
  })

  it('refuse un libellé vide', async () => {
    await expect(createWebhook(userId, { ...BASE, label: '  ' })).rejects.toBeInstanceOf(
      WebhookValidationError,
    )
  })

  it('donne un message d erreur en français', async () => {
    await expect(createWebhook(userId, { ...BASE, url: 'nawak' })).rejects.toThrow(/URL/i)
  })
})

describe('lecture et modification', () => {
  it('isole par utilisateur', async () => {
    await createWebhook(userId, BASE)
    await createWebhook(autreId, { ...BASE, label: 'autre' })

    expect(await listWebhooks(userId)).toHaveLength(1)
    expect((await listWebhooks(userId))[0]!.label).toBe('n8n')
  })

  it('refuse de lire l abonnement d un autre', async () => {
    const w = await createWebhook(autreId, BASE)
    await expect(getWebhook(userId, w.id)).rejects.toThrow()
  })

  it('refuse de livrer le secret d un autre', async () => {
    const w = await createWebhook(autreId, { ...BASE, secret: 'secret-d-autrui' })
    await expect(getWebhookSecret(userId, w.id)).rejects.toThrow()
    expect(await getWebhookSecret(autreId, w.id)).toBe('secret-d-autrui')
  })

  it('refuse de modifier l abonnement d un autre', async () => {
    const w = await createWebhook(autreId, BASE)
    await expect(updateWebhook(userId, w.id, { label: 'volé' })).rejects.toThrow()
    expect((await getWebhook(autreId, w.id)).label).toBe('n8n')
  })

  it('refuse de supprimer l abonnement d un autre', async () => {
    const w = await createWebhook(autreId, BASE)
    await expect(deleteWebhook(userId, w.id)).rejects.toThrow()
    expect(await prisma.webhook.count({ where: { id: w.id } })).toBe(1)
  })

  it('remplace la liste d événements plutôt que de la compléter', async () => {
    const w = await createWebhook(userId, { ...BASE, events: ['cra.valide', 'saisie.creee'] })
    const maj = await updateWebhook(userId, w.id, { events: ['cra.refuse'] })
    expect(maj.events).toEqual(['cra.refuse'])
  })

  it('suspend à la main sans toucher au curseur', async () => {
    const w = await createWebhook(userId, BASE)
    const maj = await updateWebhook(userId, w.id, { state: 'SUSPENDU' })
    expect(maj.state).toBe('SUSPENDU')
    expect(maj.suspendedAt).not.toBeNull()
    expect(maj.lastSeq).toBe(w.lastSeq)
  })
})

describe('reprise après suspension', () => {
  it('repart de l instant présent et remet le compteur à zéro', async () => {
    const w = await createWebhook(userId, BASE)
    await prisma.webhook.update({
      where: { id: w.id },
      data: {
        state: 'SUSPENDU',
        consecutiveFailures: 12,
        lastError: 'ECONNREFUSED',
        suspendedAt: new Date(),
      },
    })

    // Trois événements pendant la suspension.
    for (let i = 1; i <= 3; i++) {
      await appendAudit({
        ...ACTEUR_SYSTEME,
        action: 'cra.valide',
        entityType: 'Cra',
        entityId: `c${i}`,
        payload: {},
      })
    }

    const repris = await updateWebhook(userId, w.id, { state: 'ACTIF' })

    // Pas de déversement : six mois d'arriéré sur une URL qui vient de
    // revenir serait une inondation, pas une résilience.
    expect(repris.lastSeq).toBe(3)
    expect(repris.consecutiveFailures).toBe(0)
    expect(repris.lastError).toBe('')
    expect(repris.suspendedAt).toBeNull()
  })

  it('LES ÉVÉNEMENTS DE LA PÉRIODE SUSPENDUE RESTENT TOUS LISIBLES', async () => {
    // La promesse centrale : un abonnement suspendu ne fait perdre aucun
    // événement — ils sont dans le journal, et se rattrapent par `since`.
    const { readAuditSince } = await import('@/services/audit')

    const w = await createWebhook(userId, BASE)
    await prisma.webhook.update({ where: { id: w.id }, data: { state: 'SUSPENDU' } })

    for (let i = 1; i <= 3; i++) {
      await appendAudit({
        ...ACTEUR_SYSTEME,
        action: 'cra.valide',
        entityType: 'Cra',
        entityId: `c${i}`,
        payload: {},
      })
    }

    const repris = await updateWebhook(userId, w.id, { state: 'ACTIF' })

    const manques = await readAuditSince({ since: w.lastSeq, limit: 500 })
    expect(manques.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(repris.lastSeq).toBe(3)
  })
})

describe('seuil de suspension', () => {
  it('rend le seuil configuré, celui-là même que la livraison applique', async () => {
    // L'écran affiche « n échecs sur ce seuil » : un seuil affiché autre que
    // celui qui suspend serait pire qu'un seuil caché.
    await prisma.settings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', webhookMaxEchecs: 7 },
      update: { webhookMaxEchecs: 7 },
    })

    expect(await readSeuilSuspension()).toBe(7)

    await prisma.settings.update({ where: { id: 'singleton' }, data: { webhookMaxEchecs: 10 } })
  })
})

describe('journal', () => {
  it('ne consigne pas la gestion des abonnements', async () => {
    // Le catalogue ne porte aucun événement d'abonnement, et c'est voulu :
    // il décrit les actes du métier, pas la configuration de la plomberie.
    const w = await createWebhook(userId, BASE)
    await updateWebhook(userId, w.id, { label: 'renommé' })
    await deleteWebhook(userId, w.id)

    expect(await prisma.auditEvent.count()).toBe(0)
  })
})
