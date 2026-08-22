import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { ENTITY_CRA } from '@/core/sync/policy'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { updateSettings } from '@/services/settings'
import { saveInstanceCredential } from '@/services/credentials'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { enqueueSync, flushOutbox } from '@/services/sync/outbox'
import type { SyncJob } from '@/services/sync/types'
import { FakeDolibarr } from './fake'
import { DOLIBARR, DolibarrMappingError, DolibarrUnavailableError } from './api'
import { attachClient, attachMission, detachEntity } from './import'
import { pushCraTimes, createDolibarrHandler } from './push'

let userId = ''
let autreId = ''
let clientId = ''
let missionId = ''
let lineId = ''
/** Seconde prestation de la même mission : deux lignes, deux tâches Dolibarr. */
let autreLineId = ''
/** Seconde mission du même utilisateur, jamais rattachée à ce projet. */
let autreMissionId = ''
let autreMissionLineId = ''

let api: FakeDolibarr
let projectId = 0

function job(craId: string, entityType: string = ENTITY_CRA): SyncJob {
  return {
    id: 'job',
    userId,
    entityType,
    entityId: craId,
    provider: DOLIBARR,
    operation: 'UPSERT',
    attempts: 0,
    payload: {},
  }
}

async function craValide(month: string, mission = missionId): Promise<string> {
  const cra = await getOrCreateCra(userId, mission, month)
  await transitionCra(userId, cra.id, 'ENVOYER')
  await transitionCra(userId, cra.id, 'VALIDER')
  return cra.id
}

async function rouvrir(craId: string): Promise<void> {
  await transitionCra(userId, craId, 'ROUVRIR')
}

async function revalider(craId: string): Promise<void> {
  await transitionCra(userId, craId, 'ENVOYER')
  await transitionCra(userId, craId, 'VALIDER')
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  const u = await prisma.user.create({
    data: { email: 'push@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'autre-push@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('PUSH client')
  clientId = c.id
  const m = await createMission({ clientId: c.id, label: 'PUSH mission' })
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
  autreLineId = (
    await createLine({
      missionId,
      userId,
      label: 'Recette',
      soldCentiemes: 3000,
      tjmCents: 80_000,
    })
  ).id

  const m2 = await createMission({ clientId: c.id, label: 'PUSH mission bis' })
  autreMissionId = m2.id
  autreMissionLineId = (
    await createLine({
      missionId: autreMissionId,
      userId,
      label: 'Maintenance',
      soldCentiemes: 3000,
      tjmCents: 80_000,
    })
  ).id

  // L'autre utilisateur est affecté à la même prestation : c'est ce qui rend
  // observable le cloisonnement du push. Sans saisie à lui, un push mal scopé
  // ne pousserait rien de toute façon, et le test passerait pour une raison
  // qui n'est pas celle qu'il prétend vérifier.
  await prisma.assignment.create({
    data: { lineId, userId: autreId, soldCentiemes: 3000 },
  })
})

beforeEach(async () => {
  vi.restoreAllMocks()
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.syncOutbox.deleteMany({})
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  // Un test renomme la prestation : le libellé revient à sa valeur d'origine
  // avant chaque cas, sinon l'ordre des tests deviendrait signifiant.
  await prisma.missionLine.update({ where: { id: lineId }, data: { label: 'Développement' } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })

  api = new FakeDolibarr()
  // Le Dolibarr du porteur compte des journées de 7 h là où l'application en
  // compte 8. Le réglage est posé sur le double dans TOUS les cas : aucun
  // résultat de ce fichier ne doit en dépendre.
  api.setup.TIMESHEET_DAY_DURATION = '7'
  projectId = api.seedProject({ ref: 'PJ001', title: 'PUSH mission', socid: 1 }).id

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
      externalId: String(projectId),
    },
  })
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({})
  await prisma.cra.deleteMany({})
  await prisma.syncOutbox.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.user.deleteMany({
    where: { email: { in: ['push@test.local', 'autre-push@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'PUSH client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('push des temps', () => {
  it('crée la tâche au premier push, et n en crée pas de seconde au suivant', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const premier = await pushCraTimes({ userId, craId, api })
    expect(premier.tachesCreees).toBe(1)
    expect(api.tasks).toHaveLength(1)
    expect(api.tasks[0]!.label).toBe('Développement')

    const second = await pushCraTimes({ userId, craId, api })
    expect(second.tachesCreees).toBe(0)
    expect(api.appels.createTask).toBe(1)
    expect(api.tasks).toHaveLength(1)
  })

  it('adopte une tâche existante portant le même libellé', async () => {
    await api.createTask({ projectId, label: 'Développement', plannedWorkloadSeconds: null })
    api.appels.createTask = 0

    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    await pushCraTimes({ userId, craId, api })
    expect(api.appels.createTask).toBe(0)
    expect(api.tasks).toHaveLength(1)
  })

  // L'adoption se fait sur le libellé, pas sur « la première tâche venue » :
  // un projet Dolibarr organisé à la main en porte plusieurs, et imputer le
  // développement sur la tâche de pilotage passerait totalement inaperçu.
  it('n adopte pas une tâche dont le libellé diffère', async () => {
    const pilotage = await api.createTask({ projectId, label: 'Pilotage', plannedWorkloadSeconds: null })
    api.appels.createTask = 0

    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    await pushCraTimes({ userId, craId, api })

    expect(api.appels.createTask).toBe(1)
    expect(api.tasks).toHaveLength(2)
    expect(api.timespents[0]!.taskId).not.toBe(pilotage.id)
    expect(api.tasks.find((t) => t.id === api.timespents[0]!.taskId)!.label).toBe('Développement')
  })

  it('donne à chaque prestation sa propre tâche', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 240, kind: 'REALISE' })
    await saveEntry({
      userId,
      lineId: autreLineId,
      date: '2026-05-04',
      minutes: 240,
      kind: 'REALISE',
    })
    const craId = await craValide('2026-05')

    const r = await pushCraTimes({ userId, craId, api })

    expect(r.tachesCreees).toBe(2)
    expect(new Set(api.timespents.map((t) => t.taskId)).size).toBe(2)
    expect(api.tasks.map((t) => t.label).sort()).toEqual(['Développement', 'Recette'])
  })

  it('attache le temps à la tâche, jamais au projet', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    expect(api.timespents[0]!.taskId).toBe(api.tasks[0]!.id)
    expect(api.timespents[0]!.dolibarrUserId).toBe(7)
  })

  it('ne pousse que le réalisé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 480, kind: 'PREVISIONNEL' })
    const craId = await craValide('2026-05')

    const r = await pushCraTimes({ userId, craId, api })
    expect(r.poussees).toBe(1)
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04'])
  })

  it('pousse la durée écoulée même quand Dolibarr compte une journée plus courte', async () => {
    // Réglage local à 8 h, Dolibarr à 7 h. Une journée pleine part à 28 800 s :
    // `TIMESHEET_DAY_DURATION` n'entre jamais dans le calcul, il ne gouverne que
    // l'affichage jour/heure de Dolibarr. Compenser ici ferait passer 8 h
    // réellement travaillées pour 7 h — l'écart se signale (tâche 11), il ne se
    // rattrape pas en douce (voir `core/dolibarr/timespent.ts`).
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    expect(api.timespents[0]!.durationSeconds).toBe(28_800)
  })

  it('utilise le facteur figé de la saisie, pas le réglage courant', async () => {
    await updateSettings({ minutesParJour: 420 })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 420, kind: 'REALISE' })
    await updateSettings({ minutesParJour: 480 })

    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    // 420 minutes saisies restent 420 minutes : 25 200 s.
    expect(api.timespents[0]!.durationSeconds).toBe(25_200)
  })

  // Le test ci-dessus ne prouve pas à lui seul que le facteur figé est *lu* :
  // `durationSeconds` vaut `minutes × 60`, il ne dépend d'aucun facteur. Celui-ci
  // le prouve, en passant par la seule porte où le facteur compte — la garde du
  // noyau. Un push qui recopierait le réglage courant à la place de la colonne
  // ne verrait jamais la valeur corrompue et pousserait la saisie quand même.
  it('refuse de pousser une saisie dont le facteur figé est inexploitable', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await prisma.timeEntry.updateMany({ where: { userId }, data: { minutesParJour: 0 } })
    const craId = await craValide('2026-05')

    await expect(pushCraTimes({ userId, craId, api })).rejects.toThrow(/inexploitable/)
    expect(api.timespents).toEqual([])
  })

  it('ne pousse rien pour un mois hors du CRA', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-06-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    await pushCraTimes({ userId, craId, api })
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04'])
  })

  // Un CRA porte une mission, et une seule. Sans ce filtre, le temps d'une
  // autre mission du même mois partirait sur le projet Dolibarr de celle-ci —
  // et le client verrait facturé du temps passé chez son voisin.
  it('ne pousse pas le temps d une autre mission du même mois', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({
      userId,
      lineId: autreMissionLineId,
      date: '2026-05-05',
      minutes: 480,
      kind: 'REALISE',
    })
    const craId = await craValide('2026-05')

    const r = await pushCraTimes({ userId, craId, api })

    expect(r.poussees).toBe(1)
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04'])
    expect(api.tasks.map((t) => t.label)).toEqual(['Développement'])
  })

  // Le mois voisin de la même mission a ses propres cellules. La relecture des
  // correspondances est bornée au préfixe `craId|` : sans cette borne, la
  // réconciliation de juin ne retrouverait aucune saisie derrière les
  // correspondances de mai et **retirerait de Dolibarr tout le mois de mai**,
  // déjà validé et déjà facturé.
  it('ne réconcilie que les cellules de son propre CRA', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const maiId = await craValide('2026-05')
    await pushCraTimes({ userId, craId: maiId, api })

    await saveEntry({ userId, lineId, date: '2026-06-02', minutes: 480, kind: 'REALISE' })
    const juinId = await craValide('2026-06')
    const juin = await pushCraTimes({ userId, craId: juinId, api })

    expect(juin).toEqual({ poussees: 1, misesAJour: 0, supprimees: 0, tachesCreees: 0 })
    expect(api.appels.deleteTimeSpent).toBe(0)
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04', '2026-06-02'])
  })

  // Le CRA appartient à un compte, les saisies aussi. Les deux consultants sont
  // affectés à la même prestation et saisissent le même mois : sans le scope
  // sur les saisies, le CRA du premier emporterait les journées du second.
  it('ne pousse pas les saisies d un autre consultant sur la même prestation', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({
      userId: autreId,
      lineId,
      date: '2026-05-05',
      minutes: 480,
      kind: 'REALISE',
    })
    const craId = await craValide('2026-05')

    const r = await pushCraTimes({ userId, craId, api })

    expect(r.poussees).toBe(1)
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04'])
  })

  // Une fois la prestation rattachée à une tâche, c'est le rattachement qui
  // fait foi, plus le libellé : renommer la prestation ne doit pas ouvrir une
  // seconde tâche et couper le temps du client en deux.
  it('garde la tâche rattachée même après un renommage de la prestation', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    await prisma.missionLine.update({
      where: { id: lineId },
      data: { label: 'Développement (avenant)' },
    })

    await rouvrir(craId)
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 480, kind: 'REALISE' })
    await revalider(craId)

    const r = await pushCraTimes({ userId, craId, api })

    expect(r).toEqual({ poussees: 1, misesAJour: 1, supprimees: 0, tachesCreees: 0 })
    expect(api.appels.createTask).toBe(1)
    expect(api.tasks).toHaveLength(1)
    expect(new Set(api.timespents.map((t) => t.taskId)).size).toBe(1)
  })

  // LA mutation de cette tâche : rejouer un push ne doit jamais créer un
  // second temps consommé chez le client. `addTimeSpent` n'a aucune
  // idempotence côté Dolibarr — c'est la table de correspondance qui la porte.
  it('rejoué à l identique, ne crée aucun doublon de temps', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    await pushCraTimes({ userId, craId, api })
    await pushCraTimes({ userId, craId, api })
    const troisieme = await pushCraTimes({ userId, craId, api })

    expect(api.appels.addTimeSpent).toBe(1)
    expect(api.timespents).toHaveLength(1)
    expect(api.timespents[0]!.durationSeconds).toBe(28_800)
    expect(troisieme).toEqual({ poussees: 0, misesAJour: 1, supprimees: 0, tachesCreees: 0 })
  })

  // Le lien de correspondance est écrit cellule par cellule, juste après
  // l'appel qui la pousse. Grouper ces écritures en fin de push suffirait à
  // dupliquer tout ce qui précède le point de panne au premier rejeu.
  it('une panne en cours de lot ne duplique pas ce qui était déjà poussé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-05-06', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const reel = api.addTimeSpent.bind(api)
    let appels = 0
    const espion = vi.spyOn(api, 'addTimeSpent').mockImplementation(async (args) => {
      appels += 1
      if (appels === 2) throw new DolibarrUnavailableError('Instance Dolibarr injoignable.')
      return reel(args)
    })

    await expect(pushCraTimes({ userId, craId, api })).rejects.toThrow(DolibarrUnavailableError)
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04'])

    espion.mockRestore()
    const reprise = await pushCraTimes({ userId, craId, api })

    expect(reprise).toEqual({ poussees: 2, misesAJour: 1, supprimees: 0, tachesCreees: 0 })
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04', '2026-05-05', '2026-05-06'])
    expect(api.timespents).toHaveLength(3)
  })

  it('rouvrir puis revalider met à jour, ne duplique pas', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    await rouvrir(craId)
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 240, kind: 'REALISE' })
    await revalider(craId)

    const r = await pushCraTimes({ userId, craId, api })
    expect(r.misesAJour).toBe(1)
    expect(r.poussees).toBe(0)
    expect(api.timespents).toHaveLength(1)
    expect(api.timespents[0]!.durationSeconds).toBe(14_400)
  })

  // La clé de correspondance est la cellule, pas la saisie : supprimer puis
  // ressaisir donne une saisie au `cuid` neuf, et doit malgré tout retomber sur
  // le même temps passé chez Dolibarr.
  it('une saisie supprimée puis ressaisie met à jour le même temps', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })
    const timespentId = api.timespents[0]!.id

    await rouvrir(craId)
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 0, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 180, kind: 'REALISE' })
    await revalider(craId)

    const r = await pushCraTimes({ userId, craId, api })

    expect(r).toEqual({ poussees: 0, misesAJour: 1, supprimees: 0, tachesCreees: 0 })
    expect(api.appels.addTimeSpent).toBe(1)
    expect(api.timespents).toHaveLength(1)
    expect(api.timespents[0]!.id).toBe(timespentId)
    expect(api.timespents[0]!.durationSeconds).toBe(10_800)
  })

  it('retire de Dolibarr une journée supprimée localement', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })
    expect(api.timespents).toHaveLength(2)

    await rouvrir(craId)
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 0, kind: 'REALISE' })
    await revalider(craId)

    const r = await pushCraTimes({ userId, craId, api })
    expect(r.supprimees).toBe(1)
    expect(api.timespents.map((t) => t.date)).toEqual(['2026-05-04'])
  })

  // La correspondance disparaît avec le temps qu'elle désignait : sinon le
  // push suivant redemanderait la même suppression indéfiniment, et une
  // ressaisie de la cellule ferait une mise à jour sur un identifiant mort.
  it('oublie la correspondance d une journée retirée', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    await rouvrir(craId)
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 0, kind: 'REALISE' })
    await revalider(craId)
    await pushCraTimes({ userId, craId, api })

    const second = await pushCraTimes({ userId, craId, api })
    expect(second.supprimees).toBe(0)
    expect(api.appels.deleteTimeSpent).toBe(1)
    expect(
      await prisma.externalLink.count({ where: { entityType: 'CraTimeSpent', provider: DOLIBARR } }),
    ).toBe(0)
  })

  it('retire de Dolibarr une journée repassée en prévisionnel', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    await rouvrir(craId)
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'PREVISIONNEL' })
    await revalider(craId)

    await pushCraTimes({ userId, craId, api })
    expect(api.timespents).toEqual([])
  })

  it('distingue deux créneaux du même jour', async () => {
    await saveEntry({
      userId,
      lineId,
      date: '2026-05-04',
      minutes: 240,
      kind: 'REALISE',
      slotId: 'matin',
    })
    await saveEntry({
      userId,
      lineId,
      date: '2026-05-04',
      minutes: 240,
      kind: 'REALISE',
      slotId: 'apres-midi',
    })
    const craId = await craValide('2026-05')

    const r = await pushCraTimes({ userId, craId, api })
    expect(r.poussees).toBe(2)
    expect(api.timespents).toHaveLength(2)
  })

  // Deux créneaux du même jour partagent date et ligne : si la clé de
  // correspondance oubliait le créneau, le second écraserait le premier au
  // rejeu et la journée serait amputée de moitié chez le client.
  it('ne confond pas deux créneaux du même jour au rejeu', async () => {
    await saveEntry({
      userId,
      lineId,
      date: '2026-05-04',
      minutes: 240,
      kind: 'REALISE',
      slotId: 'matin',
    })
    await saveEntry({
      userId,
      lineId,
      date: '2026-05-04',
      minutes: 120,
      kind: 'REALISE',
      slotId: 'apres-midi',
    })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    const r = await pushCraTimes({ userId, craId, api })

    expect(r).toEqual({ poussees: 0, misesAJour: 2, supprimees: 0, tachesCreees: 0 })
    expect(api.timespents).toHaveLength(2)
    expect(api.timespents.map((t) => t.durationSeconds).sort((a, b) => a - b)).toEqual([
      7_200, 14_400,
    ])
  })

  it('ne pousse rien tant que le CRA n est pas validé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const cra = await getOrCreateCra(userId, missionId, '2026-05')

    const r = await pushCraTimes({ userId, craId: cra.id, api })
    expect(r).toEqual({ poussees: 0, misesAJour: 0, supprimees: 0, tachesCreees: 0 })
    expect(api.timespents).toEqual([])
  })

  // Rouvert entre la mise en file et le drainage : le CRA redevient un
  // brouillon, et le push ne doit surtout pas réconcilier — il retirerait de
  // Dolibarr tout ce qui y a été poussé, sur un CRA que l'utilisateur est en
  // train de corriger.
  it('ne retire rien d un CRA rouvert entre-temps', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    await rouvrir(craId)
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 0, kind: 'REALISE' })

    const r = await pushCraTimes({ userId, craId, api })
    expect(r).toEqual({ poussees: 0, misesAJour: 0, supprimees: 0, tachesCreees: 0 })
    expect(api.timespents).toHaveLength(1)
  })

  it('refuse de pousser une mission non rattachée, sans rejouer indéfiniment', async () => {
    await prisma.externalLink.deleteMany({ where: { entityType: 'Mission' } })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    await expect(pushCraTimes({ userId, craId, api })).rejects.toThrow(DolibarrMappingError)
    expect(await createDolibarrHandler(api).upsert(job(craId))).toEqual({
      ok: false,
      retriable: false,
      message: expect.stringContaining('projet Dolibarr'),
    })
  })

  it('refuse de pousser sans utilisateur Dolibarr renseigné', async () => {
    await saveInstanceCredential({
      provider: DOLIBARR,
      secret: 'cle-de-test',
      baseUrl: 'https://dolibarr.invalid/api/index.php',
      metadata: {},
    })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    await expect(pushCraTimes({ userId, craId, api })).rejects.toThrow(/utilisateur Dolibarr/)
    expect(api.timespents).toEqual([])
  })

  // Cloisonnement. L'autre utilisateur a ses propres saisies sur la même
  // prestation et le même mois : un push mal scopé les pousserait sur le CRA
  // du premier au lieu de ne rien faire.
  it('ne touche pas au CRA d un autre utilisateur', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await saveEntry({
      userId: autreId,
      lineId,
      date: '2026-05-05',
      minutes: 480,
      kind: 'REALISE',
    })

    const r = await pushCraTimes({ userId: autreId, craId, api })

    expect(r).toEqual({ poussees: 0, misesAJour: 0, supprimees: 0, tachesCreees: 0 })
    expect(api.timespents).toEqual([])
  })

  // Le même cloisonnement, du côté destructeur. Un push lancé par un autre
  // compte sort **avant** de lire les correspondances — le CRA ne lui
  // appartient pas — et n'a donc rien à retirer : c'est le premier test.
  it('ne retire rien, et n appelle même pas Dolibarr, sur le CRA d un autre', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })
    const appelsAvant = { ...api.appels }

    await pushCraTimes({ userId: autreId, craId, api })

    expect(api.appels).toEqual(appelsAvant)
    expect(api.timespents).toHaveLength(1)
  })

  // Le filtre `userId` de la relecture des correspondances, lui, ne peut pas
  // se vérifier par ce chemin : le push d'un autre compte sort bien avant de
  // l'atteindre, et le test ci-dessus le laissait donc supprimer sans que
  // rien ne bouge. Ce qu'il protège vraiment est ici : une correspondance de
  // temps consommé posée sous un AUTRE compte, sur le même CRA. Sans le
  // filtre, la réconciliation ne lui trouve aucune saisie locale et demande à
  // Dolibarr de retirer un temps qui ne la regarde pas.
  it('ne retire pas un temps consommé poussé sous un autre compte', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })
    const taskId = api.timespents[0]!.taskId
    const etranger = await api.addTimeSpent({
      taskId,
      dolibarrUserId: 7,
      date: '2026-05-06',
      durationSeconds: 3600,
      note: '',
    })
    await prisma.externalLink.create({
      data: {
        userId: autreId,
        entityType: 'CraTimeSpent',
        entityId: `${craId}|${lineId}|2026-05-06|`,
        provider: DOLIBARR,
        externalId: `${taskId}:${etranger.timespentId}`,
        syncState: 'SYNCED',
      },
    })

    const r = await pushCraTimes({ userId, craId, api })

    expect(r.supprimees).toBe(0)
    expect(api.appels.deleteTimeSpent).toBe(0)
    expect(api.timespents.map((t) => t.date).sort()).toEqual(['2026-05-04', '2026-05-06'])
    expect(
      await prisma.externalLink.count({ where: { userId: autreId, entityType: 'CraTimeSpent' } }),
    ).toBe(1)
  })
})

/**
 * Repointer une mission vers un autre projet.
 *
 * Le danger : la correspondance `mission → projet` se repointe, mais celles
 * qu'elle a engendrées — `prestation → tâche` et `cellule → temps passé` —
 * désignent des objets de l'**ancien** projet. Sans rupture, tous les temps
 * suivants continuent d'y atterrir, y compris ceux de mois neufs, et le
 * nouveau projet reste vide. Si le client a lui aussi été repointé, ils
 * partent chez l'ancien tiers : exactement ce que `verifierCoherenceTiers`
 * existe pour fermer, et qu'elle ne peut pas voir puisqu'elle ne s'exécute
 * qu'à l'instant du rattachement.
 */
describe('repointage de la mission vers un autre projet', () => {
  /** Projet de chaque temps consommé, tel que Dolibarr le rangerait. */
  function projetDesTemps(): Array<{ date: string; projet: number | undefined }> {
    const projetDeLaTache = new Map(api.tasks.map((t) => [t.id, t.projectId]))
    return api.timespents.map((t) => ({ date: t.date, projet: projetDeLaTache.get(t.taskId) }))
  }

  it('envoie les temps suivants dans le NOUVEAU projet, chez le NOUVEAU tiers', async () => {
    await attachClient({ userId, clientId, dolibarrThirdpartyId: 1 })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    // Le porteur constate que la mission pointe sur le mauvais projet : il
    // repointe le client sur son vrai tiers, détache la mission, la rattache.
    const tiersB = api.seedThirdparty('PUSH client chez B')
    const projetB = api.seedProject({ ref: 'PJ002', title: 'PUSH mission', socid: tiersB.id })
    await attachClient({ userId, clientId, dolibarrThirdpartyId: tiersB.id })
    await detachEntity({ userId, entityType: 'Mission', entityId: missionId })
    await attachMission({
      userId,
      missionId,
      dolibarrProjectId: projetB.id,
      projectRef: 'PJ002',
      projectSocid: tiersB.id,
    })

    // Un jour neuf, sur un CRA revalidé.
    await rouvrir(craId)
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 480, kind: 'REALISE' })
    await revalider(craId)
    await pushCraTimes({ userId, craId, api })

    // Tout le CRA vit désormais chez le nouveau tiers — le jour neuf comme
    // celui d'avant le repointage.
    expect(
      projetDesTemps()
        .filter((t) => t.projet === projetB.id)
        .map((t) => t.date)
        .sort(),
    ).toEqual(['2026-05-04', '2026-05-05'])
    // L'ancien projet garde ce qu'on lui a livré — l'application ne détruit pas
    // chez le client ce qu'elle y a poussé — mais **plus rien ne s'y écrit** :
    // ni jour neuf, ni réécriture d'un jour ancien. Une mise à jour partant là
    // -bas serait une écriture chez le tiers précédent, exactement le danger
    // que le refus de cohérence existe pour fermer.
    expect(projetDesTemps().filter((t) => t.projet === projectId).map((t) => t.date)).toEqual([
      '2026-05-04',
    ])
    expect(api.appels.updateTimeSpent).toBe(0)
    expect(api.appels.deleteTimeSpent).toBe(0)
    // La tâche est adoptée ou créée dans le nouveau projet, pas empruntée à
    // l'ancien : `tachesCreees: 0` était la signature du défaut.
    expect(api.tasks.filter((t) => t.projectId === projetB.id)).toHaveLength(1)
  })

  // Une correspondance `prestation → tâche` posée avant que le repointage
  // sache les rompre désigne une tâche d'un projet auquel la mission n'est
  // plus rattachée. Le push ne doit pas s'en servir : elle ne dit pas de quel
  // projet elle vient, et la croire sur parole est ce qui envoyait les temps
  // chez l'ancien tiers.
  it('n emprunte pas la tâche d un autre projet, même sur une correspondance héritée', async () => {
    const ailleurs = api.seedProject({ ref: 'PJ003', title: 'Ailleurs', socid: 9 })
    const tacheAilleurs = await api.createTask({
      projectId: ailleurs.id,
      label: 'Développement',
      plannedWorkloadSeconds: null,
    })
    await prisma.externalLink.create({
      data: {
        userId,
        entityType: 'MissionLine',
        entityId: lineId,
        provider: DOLIBARR,
        externalId: String(tacheAilleurs.id),
      },
    })

    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await pushCraTimes({ userId, craId, api })

    expect(projetDesTemps()).toEqual([{ date: '2026-05-04', projet: projectId }])
  })

  // Variante intra-tiers, la plus courante : un projet Dolibarr neuf par année
  // civile pour le même client. Le refus de cohérence ne se déclenche pas du
  // tout — les deux projets appartiennent bien au même tiers — et l'année N+1
  // se remplissait silencieusement dans le projet de l'année N.
  it('suit le projet neuf du même tiers, sans passer par un détachement', async () => {
    await attachClient({ userId, clientId, dolibarrThirdpartyId: 1 })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const mai = await craValide('2026-05')
    await pushCraTimes({ userId, craId: mai, api })

    const projet2027 = api.seedProject({ ref: 'PJ2027', title: 'PUSH mission 2027', socid: 1 })
    await attachMission({
      userId,
      missionId,
      dolibarrProjectId: projet2027.id,
      projectRef: 'PJ2027',
      projectSocid: 1,
    })

    // Le mois de mai est rouvert, complété, revalidé : ses cellules portent
    // déjà des correspondances vers l'ancien projet.
    await rouvrir(mai)
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 480, kind: 'REALISE' })
    await revalider(mai)
    await pushCraTimes({ userId, craId: mai, api })

    expect(
      projetDesTemps()
        .filter((t) => t.projet === projet2027.id)
        .map((t) => t.date)
        .sort(),
    ).toEqual(['2026-05-04', '2026-05-05'])
    expect(api.appels.updateTimeSpent).toBe(0)
    expect(api.appels.deleteTimeSpent).toBe(0)
  })
})

describe('gestionnaire de file Dolibarr', () => {
  it('rend un échec rejouable quand Dolibarr est en panne', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    api.panne = true

    expect(await createDolibarrHandler(api).upsert(job(craId))).toEqual({
      ok: false,
      retriable: true,
      message: expect.stringContaining('injoignable'),
    })
  })

  // Le test ci-dessus ne vaut que si le push atteint réellement Dolibarr :
  // armé sur un CRA sans saisie, il rendrait `ok: true` sans jamais toucher
  // l'API et ne prouverait rien. Celui-ci fixe l'armement.
  it('atteint réellement Dolibarr, panne ou non', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    expect(await createDolibarrHandler(api).upsert(job(craId))).toEqual({ ok: true })
    expect(api.appels.addTimeSpent).toBe(1)
  })

  it('réussit sur un CRA validé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    expect(await createDolibarrHandler(api).upsert(job(craId))).toEqual({ ok: true })
  })

  it('refuse un type d entité qu il ne sait pas traiter', async () => {
    const r = await createDolibarrHandler(api).upsert(job('x', 'TimeEntry'))
    expect(r).toEqual({
      ok: false,
      retriable: false,
      message: expect.stringContaining('TimeEntry'),
    })
    expect(api.timespents).toEqual([])
  })

  it('refuse une suppression de CRA, en disant quoi faire à la place', async () => {
    const r = await createDolibarrHandler(api).remove(job('x'))
    expect(r).toEqual({
      ok: false,
      retriable: false,
      message: expect.stringContaining('revalidez'),
    })
  })

  // Une erreur imprévue n'est pas un verdict : elle remonte au drainage, qui
  // la traite comme rejouable. La convertir ici en `ok: true` consommerait la
  // ligne de file et perdrait le CRA en silence.
  it('laisse remonter une erreur qu il ne sait pas qualifier', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await prisma.timeEntry.updateMany({ where: { userId }, data: { minutesParJour: 0 } })
    const craId = await craValide('2026-05')

    await expect(createDolibarrHandler(api).upsert(job(craId))).rejects.toThrow(/inexploitable/)
  })
})

// Le drainage générique lit la file en filtrant sur le fournisseur : c'est ce
// filtre qui empêchait le drainage de l'agenda d'avaler les lignes Dolibarr.
// Ces trois tests vérifient que le gestionnaire s'y inscrit sous la bonne clé,
// plutôt que d'être appelé à la main par le push.
describe('inscription dans la file générique', () => {
  async function enfiler(craId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await enqueueSync(tx, {
        userId,
        entityType: ENTITY_CRA,
        entityId: craId,
        provider: DOLIBARR,
      })
    })
  }

  it('pousse le CRA et consomme la ligne', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await enfiler(craId)

    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: createDolibarrHandler(api) },
    })

    expect(rapport).toEqual({ traitees: 1, reussies: 1, replanifiees: 0, echouees: 0 })
    expect(api.timespents).toHaveLength(1)
    expect(await prisma.syncOutbox.count({ where: { userId, provider: DOLIBARR } })).toBe(0)
    // La saisie a mis sa propre ligne en file pour l'agenda : ce drainage-ci
    // ne draine pas ce fournisseur, il ne doit pas y toucher. C'est le sens du
    // filtre par fournisseur, et le défaut symétrique — le drainage de
    // l'agenda avalant les lignes Dolibarr — a réellement existé.
    expect(await prisma.syncOutbox.count({ where: { userId, provider: 'GOOGLE' } })).toBe(1)
  })

  it('replanifie sans consommer la ligne quand Dolibarr est en panne', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await enfiler(craId)
    api.panne = true

    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: createDolibarrHandler(api) },
    })

    expect(rapport).toEqual({ traitees: 1, reussies: 0, replanifiees: 1, echouees: 0 })
    const ligne = await prisma.syncOutbox.findFirstOrThrow({
      where: { userId, provider: DOLIBARR },
    })
    expect(ligne.state).toBe('PENDING')
    expect(ligne.lastError).toContain('injoignable')
  })

  it('abandonne tout de suite une mission non rattachée', async () => {
    await prisma.externalLink.deleteMany({ where: { entityType: 'Mission' } })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    await enfiler(craId)

    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: createDolibarrHandler(api) },
    })

    expect(rapport).toEqual({ traitees: 1, reussies: 0, replanifiees: 0, echouees: 1 })
    const ligne = await prisma.syncOutbox.findFirstOrThrow({
      where: { userId, provider: DOLIBARR },
    })
    expect(ligne.state).toBe('FAILED')
    expect(ligne.lastError).toContain('projet Dolibarr')
  })
})
