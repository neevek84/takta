import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { ENTITY_CRA } from '@/core/sync/policy'
import { DOLIBARR } from '@/services/dolibarr/api'
import { saveInstanceCredential } from '@/services/credentials'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createLine, createMission } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra } from '@/services/cra'
import { ACTEUR_SYSTEME, appendAudit } from '@/services/audit'
import { createWebhook } from '@/services/webhooks/subscriptions'
import type { Mailer } from '@/services/notify'

/**
 * Le drainage est doublé, et c'est la seule façon d'exercer ce travail sans
 * casser deux règles du projet.
 *
 * **Le réseau d'abord.** `flushAllProviders` construit un vrai client HTTP dès
 * qu'une clé d'API Dolibarr est lisible en base — et la base de test est
 * partagée par tous les fichiers, dont quatre en posent une pendant toute leur
 * durée. Exercer le vrai drainage ici faisait donc partir une requête sortante,
 * vers le Dolibarr du porteur sur une instance de développement.
 *
 * **La file ensuite.** `flushAllProviders` n'est scopé sur aucun compte : il
 * consommait les lignes de file posées par `push.test.ts`, `cra.test.ts` et
 * `outbox.test.ts` pendant qu'ils s'exécutaient, rendant leurs comptes
 * dépendants de l'ordonnancement de vitest.
 *
 * Ce que le vrai drainage fait est couvert par `sync/drain.test.ts`, qui double
 * l'accès réseau. Ce fichier-ci ne répond que de ce que le **travail** en fait :
 * qu'il l'appelle, et qu'il en restitue le compte rendu.
 */
const { flushAllProviders } = vi.hoisted(() => ({ flushAllProviders: vi.fn() }))
vi.mock('@/services/sync/drain', () => ({ flushAllProviders }))

import { JOB_HANDLERS } from './registry'
import {
  distributionRappels,
  rafraichissementSignatures,
  rappelCloture,
  rappelSaisie,
  relanceSignatures,
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

/**
 * Le réseau, espionné pour tout le fichier.
 *
 * Aucun de ces traitements n'a le droit de sortir : la distribution des
 * rappels reçoit son `fetchFn`, et le vidage de la file passe par un drainage
 * doublé. Un appel sortant partant d'ici irait, sur l'instance de
 * développement du porteur, écrire dans son vrai Dolibarr.
 */
const reseau = vi.fn(async () => new Response('', { status: 500 }))

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

const RAPPORT_VIDE = {
  comptes: 0,
  traitees: 0,
  comptesFile: 0,
  traiteesFile: 0,
  reussiesFile: 0,
  echoueesFile: 0,
  resteFile: 0,
}

beforeEach(async () => {
  flushAllProviders.mockReset().mockResolvedValue(RAPPORT_VIDE)
  reseau.mockClear()
  vi.spyOn(globalThis, 'fetch').mockImplementation(reseau as unknown as typeof fetch)
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

afterEach(() => {
  vi.restoreAllMocks()
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

  it('ADRESSE LE RAPPEL À LA PERSONNE, PAS À LA BOÎTE DE L INSTANCE', async () => {
    // Sans cela, trois consultants reçoivent leurs trois rappels dans la même
    // boîte — celle du réglage `notificationEmail` — et deux d'entre eux ne
    // reçoivent jamais le leur. C'est la raison d'être de tout ce chemin.
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })

    await rappelSaisie({ now: NOW, userId, mailer, destinataire: 'ada@exemple.test' })

    expect(envois).toHaveLength(1)
    expect(envois[0]!.to).toBe('ada@exemple.test')
  })

  it("SANS destinataire, retombe sur la boîte de l'instance", async () => {
    // Les travaux d'instance — la chaîne du journal, les webhooks — n'ont
    // personne à qui écrire : le réglage reste leur adresse.
    await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })

    await rappelSaisie({ now: NOW, userId, mailer })

    expect(envois[0]!.to).toBe('keveen@exemple.test')
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

  it('restitue le compte rendu du drainage, reste compris', async () => {
    // Le reste est la moitié qui compte : « 3 traitées, 2 réussies » est
    // indiscernable d'une file vidée sans lui.
    flushAllProviders.mockResolvedValue({
      comptes: 2,
      traitees: 5,
      comptesFile: 3,
      traiteesFile: 4,
      reussiesFile: 2,
      echoueesFile: 1,
      resteFile: 1,
    })

    const r = await vidageFileSortie({ now: NOW, userId })

    expect(flushAllProviders).toHaveBeenCalledWith(undefined, { now: NOW })
    expect(r.message).toContain('2 compte(s), 5 ligne(s)')
    expect(r.message).toContain('3 compte(s), 4 traitée(s)')
    expect(r.message).toContain('2 réussie(s), 1 en échec, 1 en attente')
  })

  // AUCUN TEST DE CE PROJET N'APPELLE DOLIBARR. Le décor ci-dessous est
  // exactement celui qui faisait partir une requête sortante : une clé d'API
  // d'instance en base, une mission rattachée à un projet, un CRA validé et sa
  // ligne de file. Le drainage étant doublé, rien de tout cela ne peut plus
  // atteindre le réseau — et si le double disparaît, ce test le dit.
  it('NE TOUCHE PAS AU RÉSEAU, clé Dolibarr enregistrée ou non', async () => {
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
    const mois = new Date('2026-08-01T00:00:00.000Z')
    try {
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
          externalId: '42',
        },
      })
      await saveEntry({ userId, lineId, date: '2026-08-03', minutes: 480, kind: 'REALISE' })
      const cra = await prisma.cra.create({
        data: { userId, missionId, month: mois, status: 'VALIDE' },
      })
      await prisma.syncOutbox.create({
        data: {
          userId,
          entityType: ENTITY_CRA,
          entityId: cra.id,
          provider: DOLIBARR,
          operation: 'UPSERT',
          payloadJson: '{}',
          state: 'PENDING',
          attempts: 0,
          lastError: '',
          nextAttemptAt: NOW,
        },
      })

      await vidageFileSortie({ now: NOW, userId })

      expect(reseau).not.toHaveBeenCalled()
    } finally {
      // La base de test est partagée par tous les fichiers : une clé d'instance
      // qui survivrait à ce test ferait construire un vrai client HTTP dans
      // ceux qui tournent en même temps.
      await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
      await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
      await prisma.syncOutbox.deleteMany({ where: { userId } })
    }
  })

  it('énumère les comptes, plutôt que le seul appelant', async () => {
    // Un réveil externe n'a pas de session : le chemin appelé par un cron
    // doit drainer tous les comptes, pas celui qu'on lui a passé.
    const source = readFileSync(path.join(__dirname, 'handlers.ts'), 'utf8')
    expect(source).toContain('flushAllProviders')
    expect(source).not.toContain('drainProvidersForUser')
  })
})

describe('relance de signature', () => {
  const NOW = new Date('2026-08-15T10:00:00.000Z')

  it('LE TRAVAIL EXISTE ET RELANCE VRAIMENT, sans qu on lui passe de session', async () => {
    // Le défaut que ce test ferme : `signature.relance` était déclaré, son
    // traitement écrit et testé — et inscrit nulle part. Un cron branché sur
    // `POST /api/jobs/tick` lisait indéfiniment « Aucun traitement enregistré ».
    await updateSettings({ relanceJours: 7 })
    const cra = await prisma.cra.create({
      data: {
        userId,
        missionId,
        month: new Date('2026-06-01T00:00:00.000Z'),
        status: 'ENVOYE',
      },
    })
    await prisma.signatureRequest.create({
      data: {
        craId: cra.id,
        provider: 'double',
        status: 'EN_ATTENTE',
        sentAt: new Date('2026-08-01T10:00:00.000Z'),
      },
    })

    const r = await relanceSignatures({ now: NOW, userId })

    // Aucun connecteur configuré : la demande est échue, comptée, et rien
    // n'échoue — c'est le mode nominal d'une instance sans outil de signature.
    expect(r.message).toMatch(/sans connecteur/i)
    expect(r.message).toContain('1 sans connecteur')
    expect(JOB_HANDLERS['signature.relance']).toBe(relanceSignatures)
  })

  it('rend compte sans rien exiger quand aucune demande n est échue', async () => {
    const r = await relanceSignatures({ now: NOW, userId })
    expect(r.message).toMatch(/relance/i)
  })
})

describe('rafraîchissement des signatures', () => {
  const NOW = new Date('2026-08-15T10:00:00.000Z')

  it('LE TRAVAIL EXISTE et rend compte sans connecteur configuré', async () => {
    const r = await rafraichissementSignatures({ now: NOW, userId })
    expect(r.message).toMatch(/demande\(s\) examinée\(s\)/i)
    expect(JOB_HANDLERS['signature.rafraichissement']).toBe(rafraichissementSignatures)
  })

  it('NE TOUCHE À AUCUN CRA sans connecteur : il applique, il ne décide pas', async () => {
    await saveEntry({ userId, lineId, date: '2026-08-13', minutes: 480, kind: 'PREVISIONNEL' })
    const cra = await prisma.cra.create({
      data: {
        userId,
        missionId,
        month: new Date('2026-07-01T00:00:00.000Z'),
        status: 'ENVOYE',
      },
    })
    await prisma.signatureRequest.create({
      data: { craId: cra.id, provider: 'double', status: 'EN_ATTENTE' },
    })
    const avant = await photographie()

    await rafraichissementSignatures({ now: NOW, userId })

    expect(await photographie()).toEqual(avant)
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
    // L'attente a changé : les deux travaux de signature étaient déclarés,
    // écrits, testés — et branchés sur rien. Un cron sur `POST /api/jobs/tick`
    // affichait indéfiniment « Aucun traitement enregistré » pour eux.
    expect(Object.keys(JOB_HANDLERS).sort()).toEqual([
      'journal.verification',
      'outbox.flush',
      'rappel.cloture',
      'rappel.saisie',
      'signature.rafraichissement',
      'signature.relance',
      'webhooks.distribute',
    ])
  })
})
