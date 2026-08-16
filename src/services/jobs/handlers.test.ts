import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/db/client'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createLine, createMission } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra } from '@/services/cra'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { createWebhook } from '@/services/webhooks/subscriptions'
import type { Mailer } from '@/services/notify'
import { JOB_HANDLERS } from './registry'
import {
  distributionRappels,
  rappelCloture,
  rappelSaisie,
  verificationJournal,
  vidageFileSortie,
} from './handlers'

let userId = ''
let missionId = ''
let lineId = ''

const envois: Array<{ to: string; sujet: string; corps: string }> = []
const mailer: Mailer = async (message) => {
  envois.push(message)
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { email: 'handlers@test.local', name: 'K', passwordHash: 'x' },
    })
  ).id
  const c = await createClient('HANDLERS client', null, userId)
  missionId = (await createMission({ clientId: c.id, label: 'M', userId })).id
  lineId = (await createLine({ missionId, userId, label: 'L', soldCentiemes: 10000, tjmCents: 80000 }))
    .id
})

beforeEach(async () => {
  envois.length = 0
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.webhook.deleteMany({})
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    workingDays: [1, 2, 3, 4, 5],
    holidays: ['2026-08-05'],
  })
  await prisma.settings.update({
    where: { id: 'singleton' },
    data: { notificationEmail: 'keveen@exemple.test' },
  })
  // Le journal est vidé **après** les écritures de réglages : `updateSettings`
  // consigne `reglage.modifie`, que les décomptes de ces tests compteraient.
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.auditEvent.deleteMany({})
  await prisma.webhook.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'handlers@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'HANDLERS client' } })
  await prisma.$disconnect()
})

/** Photographie exacte des deux tables que la règle centrale protège. */
async function photographie() {
  return {
    saisies: await prisma.timeEntry.findMany({ orderBy: { id: 'asc' } }),
    cras: await prisma.cra.findMany({ orderBy: { id: 'asc' } }),
  }
}

describe('rappel de saisie', () => {
  const NOW = new Date('2026-08-07T09:00:00.000Z') // un vendredi

  it('signale les jours ouvrés du mois sans aucune saisie', async () => {
    // 3, 4, 6 ouvrés sans saisie ; 5 férié ; 7 est aujourd hui, donc exclu.
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })

    const r = await rappelSaisie({ now: NOW, userId, mailer })

    expect(r.message).toContain('2')
    expect(envois).toHaveLength(1)
    expect(envois[0]!.corps).toContain('2026-08-04')
    expect(envois[0]!.corps).toContain('2026-08-06')
    expect(envois[0]!.corps).not.toContain('2026-08-05') // férié
    expect(envois[0]!.corps).not.toContain('2026-08-07') // aujourd hui
    expect(envois[0]!.corps).not.toContain('2026-08-01') // samedi
  })

  it('N ENVOIE RIEN quand tout est saisi', async () => {
    // Pas de notification pour ce qui n'appelle aucune action.
    for (const jour of ['2026-08-03', '2026-08-04', '2026-08-06']) {
      await saveEntry({ userId, lineId, date: jour, minutes: 480, kind: 'REALISE' })
    }

    const r = await rappelSaisie({ now: NOW, userId, mailer })

    expect(envois).toHaveLength(0)
    expect(r.message).toMatch(/aucun/i)
  })

  it('compte le prévisionnel comme une saisie', async () => {
    for (const jour of ['2026-08-03', '2026-08-04']) {
      await saveEntry({ userId, lineId, date: jour, minutes: 480, kind: 'PREVISIONNEL' })
    }
    await saveEntry({ userId, lineId, date: '2026-08-06', minutes: 480, kind: 'REALISE' })

    await rappelSaisie({ now: NOW, userId, mailer })
    expect(envois).toHaveLength(0)
  })

  it('SANS SMTP, consigne au lieu d échouer', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })

    const r = await rappelSaisie({ now: NOW, userId })
    expect(r.message).toContain('SMTP')
  })

  it('NE MODIFIE NI SAISIE NI CRA', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'PREVISIONNEL' })
    await getOrCreateCra(userId, missionId, '2026-08')
    const avant = await photographie()

    await rappelSaisie({ now: NOW, userId, mailer })

    expect(await photographie()).toEqual(avant)
  })
})

describe('rappel de clôture', () => {
  const DEBUT_DE_MOIS = new Date('2026-09-03T09:00:00.000Z')
  const MILIEU_DE_MOIS = new Date('2026-09-18T09:00:00.000Z')

  it('signale les CRA en souffrance du mois écoulé', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-10', minutes: 480, kind: 'REALISE' })

    const r = await rappelCloture({ now: DEBUT_DE_MOIS, userId, mailer })

    expect(r.message).toContain('1')
    expect(envois).toHaveLength(1)
    expect(envois[0]!.sujet).toContain('2026-08')
    expect(envois[0]!.corps).toContain('ABSENT')
  })

  it('ne fait rien hors de la fenêtre de clôture', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-10', minutes: 480, kind: 'REALISE' })

    const r = await rappelCloture({ now: MILIEU_DE_MOIS, userId, mailer })

    expect(envois).toHaveLength(0)
    expect(r.message).toMatch(/fenêtre|hors/i)
  })

  it('N ENVOIE RIEN quand tous les CRA sont partis', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-10', minutes: 480, kind: 'REALISE' })
    const cra = await getOrCreateCra(userId, missionId, '2026-08')
    await prisma.cra.update({ where: { id: cra.id }, data: { status: 'ENVOYE' } })

    await rappelCloture({ now: DEBUT_DE_MOIS, userId, mailer })
    expect(envois).toHaveLength(0)
  })

  it('NE VALIDE NI N ENVOIE AUCUN CRA', async () => {
    // Aucun automatisme ne franchit une transition de CRA, y compris la
    // clôture d'un mois entièrement saisi.
    await saveEntry({ userId, lineId, date: '2026-08-10', minutes: 480, kind: 'REALISE' })
    await getOrCreateCra(userId, missionId, '2026-08')
    const avant = await photographie()

    await rappelCloture({ now: DEBUT_DE_MOIS, userId, mailer })

    expect(await photographie()).toEqual(avant)
  })
})

describe('vérification de la chaîne du journal', () => {
  const NOW = new Date('2026-08-15T03:00:00.000Z')

  async function troisEntrees() {
    for (let i = 1; i <= 3; i++) {
      await appendAudit({
        ...ACTEUR_SYSTEME,
        action: 'cra.valide',
        entityType: 'Cra',
        entityId: `c${i}`,
        payload: {},
      })
    }
  }

  it('rend compte d une chaîne intacte, sans notifier', async () => {
    await troisEntrees()
    const r = await verificationJournal({ now: NOW, userId, mailer })

    expect(r.message).toContain('3')
    expect(envois).toHaveLength(0)
  })

  it('ALERTE ET ÉCHOUE à la première rupture', async () => {
    await troisEntrees()
    await prisma.auditEvent.update({ where: { seq: 2 }, data: { payloadJson: '{"x":1}' } })

    // Le travail échoue : l'ordonnanceur le consigne et la supervision
    // l'affiche en tête. Une rupture silencieuse n'aurait aucune valeur.
    await expect(verificationJournal({ now: NOW, userId, mailer })).rejects.toThrow(/2/)
    expect(envois).toHaveLength(1)
    expect(envois[0]!.sujet).toContain('2')
    expect(envois[0]!.corps).toContain('EMPREINTE')
  })

  it('NE MODIFIE NI SAISIE NI CRA', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-12', minutes: 480, kind: 'PREVISIONNEL' })
    await getOrCreateCra(userId, missionId, '2026-08')
    const avant = await photographie()

    await verificationJournal({ now: NOW, userId, mailer })

    expect(await photographie()).toEqual(avant)
  })
})

describe('distribution des rappels sortants', () => {
  const NOW = new Date('2026-08-15T10:00:00.000Z')

  it('rend compte de ce qui est parti', async () => {
    await createWebhook(userId, {
      label: 'n8n',
      url: 'https://exemple.test/hook',
      events: [],
      secret: 's',
    })
    await appendAudit({
      ...ACTEUR_SYSTEME,
      action: 'cra.valide',
      entityType: 'Cra',
      entityId: 'c1',
      payload: {},
    })

    const r = await distributionRappels({
      now: NOW,
      userId,
      fetchFn: async () => new Response('', { status: 200 }),
    })

    expect(r.message).toMatch(/1/)
  })

  it('NE MODIFIE NI SAISIE NI CRA', async () => {
    await createWebhook(userId, {
      label: 'n8n',
      url: 'https://exemple.test/hook',
      events: [],
      secret: 's',
    })
    await saveEntry({ userId, lineId, date: '2026-08-13', minutes: 480, kind: 'PREVISIONNEL' })
    await getOrCreateCra(userId, missionId, '2026-08')
    const avant = await photographie()

    await distributionRappels({
      now: NOW,
      userId,
      fetchFn: async () => new Response('', { status: 200 }),
    })

    expect(await photographie()).toEqual(avant)
  })
})

describe('vidage de la file de sortie', () => {
  const NOW = new Date('2026-08-15T10:00:00.000Z')

  it('rend compte d une file vide sans rien exiger', async () => {
    // Aucun connecteur configuré : le travail doit rendre compte, pas
    // échouer — c'est l'état normal d'une instance autoportante.
    const r = await vidageFileSortie({ now: NOW, userId })
    expect(r.message).toMatch(/file|ligne/i)
  })

  it('énumère les comptes, plutôt que le seul appelant', async () => {
    // Un réveil externe n'a pas de session : le chemin appelé par un cron
    // doit drainer tous les comptes, pas celui qu'on lui a passé.
    const source = readFileSync(path.join(__dirname, 'handlers.ts'), 'utf8')
    expect(source).toContain('flushAllProviders')
    expect(source).not.toContain('drainProvidersForUser')
  })
})

describe('la règle centrale, balayée à la source', () => {
  it('aucun traitement n écrit dans TimeEntry ni dans Cra', () => {
    // Le test comportemental couvre ce que les traitements font aujourd'hui ;
    // celui-ci empêche d'y réintroduire une écriture demain.
    const source = readFileSync(path.join(__dirname, 'handlers.ts'), 'utf8')
    for (const interdit of [
      'timeEntry.create',
      'timeEntry.update',
      'timeEntry.updateMany',
      'timeEntry.delete',
      'timeEntry.deleteMany',
      'timeEntry.upsert',
      'cra.create',
      'cra.update',
      'cra.updateMany',
      'cra.upsert',
      'saveEntry',
      'convertPastForecast',
      'transitionCra',
      'getOrCreateCra',
    ]) {
      expect(source, `« ${interdit} » n'a rien à faire dans un traitement de fond`).not.toContain(
        interdit,
      )
    }
  })

  it('les traitements du lot sont bien ceux qui viennent d être couverts', () => {
    expect(Object.keys(JOB_HANDLERS).sort()).toEqual([
      'journal.verification',
      'outbox.flush',
      'rappel.cloture',
      'rappel.saisie',
      'webhooks.distribute',
    ])
  })
})
