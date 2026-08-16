import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { ENTITY_TIME_ENTRY, PROVIDER_GOOGLE } from '@/core/sync/policy'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { listOpenConflicts, resolveConflict } from './conflicts'

const NOW = new Date('2026-03-20T10:00:00.000Z')
const EXTERNAL_ID = 'evt-1'

let userId = ''
let autreId = ''
let missionId = ''
let lineA = ''
/** Sert à remplir une journée sans toucher la ligne en conflit. */
let lineB = ''

/**
 * `flush.ts` n'existe pas encore dans cet arbre — il est écrit en parallèle
 * (tâche 7). Les fixtures ci-dessous posent donc **à la main** l'état que le
 * drainage laisse derrière lui quand il ouvre une divergence, tel que sa
 * spécification le décrit : un `ExternalLink` porteur de l'etag connu, un
 * `SyncConflict` ouvert dont l'instantané est un `RemoteEvent` sérialisé en
 * bloc, et une file **vidée** de la ligne qui a produit le conflit.
 *
 * Le contrat exercé ici est donc celui de la base, pas celui d'un module
 * absent : l'arbitrage se juge sur ce qu'il lit et ce qu'il écrit.
 */
function cibleDe(entityId: string) {
  return { entityType: ENTITY_TIME_ENTRY, entityId, provider: PROVIDER_GOOGLE }
}

/** L'instantané distant : un `RemoteEvent`, sérialisé tel quel. */
function instantane(patch: { summary?: string; startLocal?: string; endLocal?: string }) {
  return {
    externalId: EXTERNAL_ID,
    // Google fait bouger l'etag à chaque modification : celui-ci est celui de
    // la version qu'on accepterait.
    etag: '"2"',
    summary: patch.summary ?? 'CRA · Dév',
    startLocal: patch.startLocal ?? '2026-03-12T09:00:00',
    endLocal: patch.endLocal ?? '2026-03-12T13:00:00',
    timeZone: 'Europe/Paris',
    craEntryId: '',
  }
}

async function saisirLeDouze(): Promise<string> {
  const r = await saveEntry({
    userId,
    lineId: lineA,
    date: '2026-03-12',
    minutes: 240,
    kind: 'REALISE',
  })
  expect(r.ok).toBe(true)
  const entry = await prisma.timeEntry.findFirstOrThrow({
    where: { userId, lineId: lineA, date: new Date('2026-03-12T00:00:00.000Z') },
  })
  return entry.id
}

/** Une saisie poussée, puis divergée chez Google : conflit ouvert. */
async function divergence(patch: {
  summary?: string
  startLocal?: string
  endLocal?: string
}): Promise<{ conflictId: string; entryId: string; externalId: string }> {
  const entryId = await saisirLeDouze()

  await prisma.externalLink.create({
    data: {
      ...cibleDe(entryId),
      externalId: EXTERNAL_ID,
      etag: '"1"',
      syncState: 'SYNCED',
      syncedAt: NOW,
    },
  })
  const conflit = await prisma.syncConflict.create({
    data: {
      userId,
      ...cibleDe(entryId),
      kind: 'REMOTE_MODIFIED',
      remoteSnapshotJson: JSON.stringify(instantane(patch)),
      detectedAt: NOW,
    },
  })

  // Le drainage consomme la ligne de file en ouvrant le conflit : c'est le
  // conflit qui porte l'état, plus la file.
  await prisma.syncOutbox.deleteMany({})
  return { conflictId: conflit.id, entryId, externalId: EXTERNAL_ID }
}

/** Idem, mais l'événement a disparu de Google. */
async function disparition(): Promise<{ conflictId: string; entryId: string }> {
  const entryId = await saisirLeDouze()

  await prisma.externalLink.create({
    data: {
      ...cibleDe(entryId),
      externalId: EXTERNAL_ID,
      etag: '"1"',
      syncState: 'SYNCED',
      syncedAt: NOW,
    },
  })
  const conflit = await prisma.syncConflict.create({
    data: {
      userId,
      ...cibleDe(entryId),
      kind: 'REMOTE_DELETED',
      remoteSnapshotJson: JSON.stringify({ externalId: EXTERNAL_ID }),
      detectedAt: NOW,
    },
  })

  await prisma.syncOutbox.deleteMany({})
  return { conflictId: conflit.id, entryId }
}

function verrouillerMars(): Promise<unknown> {
  return prisma.cra.create({
    data: { missionId, userId, month: new Date('2026-03-01T00:00:00Z'), status: 'VALIDE' },
  })
}

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'conflits@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'conflits-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('CONFLITS client')
  const m = await createMission({ clientId: c.id, label: 'Refonte' })
  missionId = m.id
  lineA = (await createLine({ missionId, userId, label: 'Dév', soldCentiemes: 3000, tjmCents: 0 }))
    .id
  lineB = (
    await createLine({ missionId, userId, label: 'Recette', soldCentiemes: 3000, tjmCents: 0 })
  ).id
})

beforeEach(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreId] } } })
  await updateSettings({
    minutesParJour: 480,
    capacityMode: 'DESACTIVE',
    capacityCentiemes: 100,
    journeeDebutMinute: 540,
    journeeFinMinute: 1080,
  })
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.syncConflict.deleteMany({})
  await prisma.externalLink.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({
    where: { email: { in: ['conflits@test.local', 'conflits-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'CONFLITS client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('listOpenConflicts', () => {
  it('liste la divergence ouverte avec ce que Google porte', async () => {
    await divergence({ summary: 'Déplacé à la main' })

    const liste = await listOpenConflicts(userId)
    expect(liste.length).toBe(1)
    expect(liste[0]?.kind).toBe('REMOTE_MODIFIED')
    expect(liste[0]?.remote?.summary).toBe('Déplacé à la main')
    expect(liste[0]?.libelle).toContain('Dév')
  })

  it('ne liste pas une divergence déjà arbitrée', async () => {
    const { conflictId } = await divergence({ summary: 'Déplacé' })
    await resolveConflict({ userId, conflictId, resolution: 'DETACHER' })
    expect(await listOpenConflicts(userId)).toEqual([])
  })

  it('ne laisse pas voir la divergence d un autre utilisateur', async () => {
    await divergence({ summary: 'Déplacé' })
    expect(await listOpenConflicts(autreId)).toEqual([])
  })
})

describe('accepter — le garde-fou', () => {
  // Supprimer par ce biais une ligne de temps déjà validée ouvrirait un trou
  // dans la facturation.
  it('est refusé sur un mois dont le CRA est validé', async () => {
    const { conflictId, entryId } = await divergence({
      startLocal: '2026-03-18T14:00:00',
      endLocal: '2026-03-18T18:00:00',
    })
    await verrouillerMars()

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ reason: 'VERROUILLE' })

    // Le conflit reste ouvert, la saisie n'a pas bougé.
    expect((await listOpenConflicts(userId)).length).toBe(1)
    const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(entry.date).toEqual(new Date('2026-03-12T00:00:00.000Z'))
  })

  it('est refusé quand la capacité serait dépassée', async () => {
    const { conflictId, entryId } = await divergence({
      startLocal: '2026-03-19T09:00:00',
      endLocal: '2026-03-19T17:00:00',
    })

    // Le 19 est déjà plein — sur une AUTRE ligne, sans quoi l'écriture viserait
    // la même clé et se substituerait à elle au lieu de s'y ajouter.
    await updateSettings({ capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
    await saveEntry({ userId, lineId: lineB, date: '2026-03-19', minutes: 480, kind: 'REALISE' })

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toMatchObject({ ok: false, reason: 'CAPACITE' })
    expect((await listOpenConflicts(userId)).length).toBe(1)
    const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(entry.date).toEqual(new Date('2026-03-12T00:00:00.000Z'))
  })

  // L'événement a été déplacé vers un mois déjà validé : l'écriture d'accueil
  // est une écriture comme une autre, et le verrou la refuse.
  it("est refusé quand c'est le mois d'accueil qui est validé", async () => {
    const { conflictId, entryId } = await divergence({
      startLocal: '2026-04-02T09:00:00',
      endLocal: '2026-04-02T13:00:00',
    })
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-04-01T00:00:00Z'), status: 'VALIDE' },
    })

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toMatchObject({ ok: false, reason: 'VERROUILLE' })

    // Rien n'a été posé dans le mois validé, et la saisie n'a pas bougé.
    expect(
      await prisma.timeEntry.count({
        where: { userId, date: new Date('2026-04-02T00:00:00.000Z') },
      }),
    ).toBe(0)
    const entry = await prisma.timeEntry.findUniqueOrThrow({ where: { id: entryId } })
    expect(entry.date).toEqual(new Date('2026-03-12T00:00:00.000Z'))
    expect((await listOpenConflicts(userId)).length).toBe(1)
  })

  it('donne un motif en français', async () => {
    const { conflictId } = await divergence({
      startLocal: '2026-03-18T14:00:00',
      endLocal: '2026-03-18T18:00:00',
    })
    await verrouillerMars()

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('validé')
  })

  // Le pire scénario laisse une donnée en trop, JAMAIS une donnée en moins :
  // un refus d'arbitrage ne doit pas emporter la saisie qui occupait déjà le
  // jour d'accueil, laquelle n'a rien à voir avec la divergence.
  it("n'emporte pas la saisie du mois d'accueil quand l'ancien mois est verrouillé", async () => {
    const { conflictId, entryId } = await divergence({
      startLocal: '2026-04-02T09:00:00',
      endLocal: '2026-04-02T13:00:00',
    })

    // Avril est ouvert et déjà occupé sur la même ligne : c'est exactement la
    // clé que l'écriture d'accueil viserait.
    await saveEntry({ userId, lineId: lineA, date: '2026-04-02', minutes: 480, kind: 'REALISE' })
    const avril = await prisma.timeEntry.findFirstOrThrow({
      where: { userId, lineId: lineA, date: new Date('2026-04-02T00:00:00.000Z') },
    })
    await verrouillerMars()

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toMatchObject({ ok: false, reason: 'VERROUILLE' })

    const survivante = await prisma.timeEntry.findUnique({ where: { id: avril.id } })
    expect(survivante?.minutes).toBe(480)
    expect(await prisma.timeEntry.findUnique({ where: { id: entryId } })).not.toBeNull()
    expect((await listOpenConflicts(userId)).length).toBe(1)
  })
})

describe('accepter — quand la règle passe', () => {
  it('déplace la saisie sur l événement et repointe le lien', async () => {
    const { conflictId, entryId, externalId } = await divergence({
      startLocal: '2026-03-18T14:00:00',
      endLocal: '2026-03-18T18:00:00',
    })

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toEqual({ ok: true, resolution: 'ACCEPTER' })

    expect(await prisma.timeEntry.findUnique({ where: { id: entryId } })).toBeNull()
    const deplacee = await prisma.timeEntry.findFirstOrThrow({ where: { userId } })
    expect(deplacee.date).toEqual(new Date('2026-03-18T00:00:00.000Z'))
    expect(deplacee.minutes).toBe(240)

    const link = await prisma.externalLink.findFirstOrThrow({ where: { externalId } })
    expect(link.entityId).toBe(deplacee.id)
    // L'etag distant est adopté : sans lui, le prochain drainage rouvrirait
    // exactement le même conflit.
    expect(link.etag).toBe('"2"')
  })

  it('ne repousse rien vers Google', async () => {
    const { conflictId } = await divergence({
      startLocal: '2026-03-18T14:00:00',
      endLocal: '2026-03-18T18:00:00',
    })
    await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })

    // Accepter la version agenda, c'est renoncer à pousser la sienne : la file
    // ne doit contenir aucune trace des écritures que l'arbitrage a faites.
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('supprime la saisie quand l événement a disparu', async () => {
    const { conflictId, entryId } = await disparition()

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toEqual({ ok: true, resolution: 'ACCEPTER' })

    expect(await prisma.timeEntry.findUnique({ where: { id: entryId } })).toBeNull()
    expect(await prisma.externalLink.count()).toBe(0)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('refuse de supprimer la saisie d un mois validé', async () => {
    const { conflictId, entryId } = await disparition()
    await verrouillerMars()

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toMatchObject({ ok: false, reason: 'VERROUILLE' })
    expect(await prisma.timeEntry.findUnique({ where: { id: entryId } })).not.toBeNull()
    expect((await listOpenConflicts(userId)).length).toBe(1)
  })
})

describe('rétablir', () => {
  it('remet en file et remet l etag à zéro', async () => {
    const { conflictId, entryId } = await divergence({ summary: 'Déplacé à la main' })

    const r = await resolveConflict({ userId, conflictId, resolution: 'RETABLIR' })
    expect(r).toEqual({ ok: true, resolution: 'RETABLIR' })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({ entityId: ligne.entityId, operation: ligne.operation, state: ligne.state }).toEqual({
      entityId: entryId,
      operation: 'UPSERT',
      state: 'PENDING',
    })
    // Sans cette remise à zéro, le drainage redétecterait la divergence qu'on
    // vient d'arbitrer.
    const link = await prisma.externalLink.findFirstOrThrow({ where: { entityId: entryId } })
    expect(link.etag).toBe('')
    expect((await listOpenConflicts(userId)).length).toBe(0)
  })

  it('recrée l événement quand il a disparu', async () => {
    const { conflictId, entryId } = await disparition()

    await resolveConflict({ userId, conflictId, resolution: 'RETABLIR' })

    // Le lien pointe un identifiant mort : le garder ferait tenter une mise à
    // jour vouée à l'échec au lieu d'une création.
    expect(await prisma.externalLink.count()).toBe(0)
    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({ entityId: ligne.entityId, operation: ligne.operation }).toEqual({
      entityId: entryId,
      operation: 'UPSERT',
    })
    expect((await listOpenConflicts(userId)).length).toBe(0)
  })
})

describe('détacher', () => {
  it('rompt le lien et laisse les deux côtés en place', async () => {
    const { conflictId, entryId } = await divergence({ summary: 'Déplacé' })

    const r = await resolveConflict({ userId, conflictId, resolution: 'DETACHER' })
    expect(r).toEqual({ ok: true, resolution: 'DETACHER' })

    expect(await prisma.externalLink.count()).toBe(0)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
    expect(await prisma.timeEntry.findUnique({ where: { id: entryId } })).not.toBeNull()
  })
})

describe('refus élémentaires', () => {
  it('refuse un conflit inconnu', async () => {
    const r = await resolveConflict({
      userId,
      conflictId: 'conflit-inexistant',
      resolution: 'DETACHER',
    })
    expect(r).toMatchObject({ ok: false, reason: 'INTROUVABLE' })
  })

  it('refuse d arbitrer le conflit d un autre utilisateur', async () => {
    const { conflictId } = await divergence({ summary: 'Déplacé' })
    const r = await resolveConflict({ userId: autreId, conflictId, resolution: 'DETACHER' })
    expect(r).toMatchObject({ ok: false, reason: 'INTROUVABLE' })
    expect((await listOpenConflicts(userId)).length).toBe(1)
  })

  it('refuse d accepter un instantané illisible', async () => {
    const { conflictId } = await divergence({ summary: 'Déplacé' })
    await prisma.syncConflict.update({
      where: { id: conflictId },
      data: { remoteSnapshotJson: 'pas du json' },
    })

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toMatchObject({ ok: false, reason: 'INSTANTANE_ILLISIBLE' })
    expect((await listOpenConflicts(userId)).length).toBe(1)
  })

  it('refuse d accepter quand la saisie a disparu', async () => {
    const { conflictId, entryId } = await divergence({ summary: 'Déplacé' })
    await prisma.timeEntry.delete({ where: { id: entryId } })

    const r = await resolveConflict({ userId, conflictId, resolution: 'ACCEPTER' })
    expect(r).toMatchObject({ ok: false, reason: 'SAISIE_ABSENTE' })
    expect((await listOpenConflicts(userId)).length).toBe(1)
  })
})
