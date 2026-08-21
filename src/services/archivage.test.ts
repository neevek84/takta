import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine, listMissionsForUser } from '@/services/missions'
import { listClients } from '@/services/clients'
import { DOLIBARR } from './dolibarr/api'
import { LIEN_LIGNE, LIEN_MISSION, LIEN_TEMPS, LIEN_TEMPS_REPRIS } from './dolibarr/liens'
import {
  archiverClient,
  archiverMission,
  impactSuppressionClient,
  impactSuppressionMission,
  supprimerClient,
  supprimerMission,
} from './archivage'

let userId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'archivage@test.local', name: 'A', passwordHash: 'x' },
  })
  userId = u.id
})

beforeEach(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'ARC' } } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
})

afterAll(async () => {
  await prisma.client.deleteMany({ where: { name: { startsWith: 'ARC' } } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.user.deleteMany({ where: { email: 'archivage@test.local' } })
  await prisma.$disconnect()
})

/**
 * Une mission complète : prestation, saisie, CRA validé, et les quatre natures
 * de correspondance Dolibarr qu'elle peut porter.
 */
async function decor() {
  const client = await createClient('ARC ACME')
  const mission = await createMission({ clientId: client.id, label: 'ARC Mission' })
  const ligne = await createLine({
    missionId: mission.id,
    userId,
    label: 'Cadrage',
    soldCentiemes: 500,
    tjmCents: 0,
  })
  const cra = await prisma.cra.create({
    data: {
      missionId: mission.id,
      userId,
      month: new Date('2026-07-01T00:00:00Z'),
      status: 'VALIDE',
    },
  })
  const saisie = await prisma.timeEntry.create({
    data: {
      lineId: ligne.id,
      userId,
      date: new Date('2026-07-15T00:00:00Z'),
      minutes: 420,
      kind: 'REALISE',
      slotId: '',
      startMinute: 540,
      endMinute: 960,
      minutesParJour: 420,
    },
  })

  const lien = (entityType: string, entityId: string, externalId: string) =>
    prisma.externalLink.create({
      data: { userId, entityType, entityId, provider: DOLIBARR, externalId, syncState: 'SYNCED' },
    })
  await lien(LIEN_MISSION, mission.id, '178')
  await lien(LIEN_LIGNE, ligne.id, '34')
  await lien(LIEN_TEMPS_REPRIS, saisie.id, '1000')
  await lien(LIEN_TEMPS, `${cra.id}|${ligne.id}|2026-07-15|`, '381')

  return { client, mission, ligne, cra, saisie }
}

describe('impactSuppressionMission', () => {
  // L'impact est montré **avant**, pas raconté après : une suppression ne se
  // rattrape pas, et un compte rendu a posteriori ne sert plus à rien.
  it('compte tout ce que la suppression emporterait', async () => {
    const d = await decor()

    expect(await impactSuppressionMission(d.mission.id)).toEqual({
      prestations: 1,
      saisies: 1,
      cras: 1,
      // Un CRA validé a été envoyé au client, parfois signé : il compte à part.
      crasValides: 1,
      correspondances: 4,
    })
  })

  it('rend un impact vide pour une mission qui n existe pas', async () => {
    const impact = await impactSuppressionMission('inexistante')
    expect(impact.prestations).toBe(0)
    expect(impact.correspondances).toBe(0)
  })
})

describe('archiverMission', () => {
  it('range et déserange, sans rien détruire', async () => {
    const d = await decor()

    await archiverMission(d.mission.id, true)
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: d.mission.id } })).archived).toBe(
      true,
    )
    expect(await prisma.timeEntry.count({ where: { lineId: d.ligne.id } })).toBe(1)

    await archiverMission(d.mission.id, false)
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: d.mission.id } })).archived).toBe(
      false,
    )
  })
})

describe('supprimerMission', () => {
  it('détruit la mission, son contenu, et rend ce qu elle a emporté', async () => {
    const d = await decor()

    const impact = await supprimerMission(d.mission.id)

    expect(impact.saisies).toBe(1)
    expect(await prisma.mission.count({ where: { id: d.mission.id } })).toBe(0)
    expect(await prisma.missionLine.count({ where: { id: d.ligne.id } })).toBe(0)
    expect(await prisma.timeEntry.count({ where: { id: d.saisie.id } })).toBe(0)
    expect(await prisma.cra.count({ where: { id: d.cra.id } })).toBe(0)
  })

  // `ExternalLink.entityId` est une chaîne nue, reliée à rien : la cascade de
  // la base ne l'emporte pas. Une correspondance survivante désignerait le
  // vide, et la prochaine entité à recevoir le même identifiant en hériterait.
  it('emporte les quatre natures de correspondance, que la base ne relie à rien', async () => {
    const d = await decor()

    await supprimerMission(d.mission.id)

    expect(await prisma.externalLink.count({ where: { provider: DOLIBARR } })).toBe(0)
  })

  // Une ligne de file qui vise un CRA détruit ne pourra jamais aboutir : elle
  // resterait à réessayer indéfiniment dans l'écran de supervision.
  it('vide la file de ce qui visait la mission détruite', async () => {
    const d = await decor()
    await prisma.syncOutbox.create({
      data: {
        userId,
        entityType: 'Cra',
        entityId: d.cra.id,
        provider: DOLIBARR,
        operation: 'UPSERT',
        payloadJson: '{}',
        state: 'PENDING',
        nextAttemptAt: new Date(),
      },
    })

    await supprimerMission(d.mission.id)

    expect(await prisma.syncOutbox.count({ where: { entityId: d.cra.id } })).toBe(0)
  })

  it('laisse les autres missions du même client intactes', async () => {
    const d = await decor()
    const autre = await createMission({ clientId: d.client.id, label: 'ARC Autre' })

    await supprimerMission(d.mission.id)

    expect(await prisma.mission.count({ where: { id: autre.id } })).toBe(1)
    expect(await prisma.client.count({ where: { id: d.client.id } })).toBe(1)
  })
})

describe('la portée de l archivage', () => {
  // Ranger sans faire disparaître ne range rien.
  it('sort la mission archivée de la liste', async () => {
    const d = await decor()
    expect((await listMissionsForUser(userId)).some((m) => m.id === d.mission.id)).toBe(true)

    await archiverMission(d.mission.id, true)

    expect((await listMissionsForUser(userId)).some((m) => m.id === d.mission.id)).toBe(false)
  })

  // Un client rangé emmène ses missions : sans cela, elles resteraient dans la
  // liste sous un client qui n'y est plus.
  it('sort le client archivé et ses missions', async () => {
    const d = await decor()

    await archiverClient(d.client.id, true)

    expect((await listClients(userId)).some((c) => c.id === d.client.id)).toBe(false)
    expect((await listMissionsForUser(userId)).some((m) => m.id === d.mission.id)).toBe(false)
  })
})

describe('supprimerClient', () => {
  it('emporte ses missions, et le dit', async () => {
    const d = await decor()
    await createMission({ clientId: d.client.id, label: 'ARC Autre' })

    const attendu = await impactSuppressionClient(d.client.id)
    const impact = await supprimerClient(d.client.id)

    expect(impact).toEqual(attendu)
    expect(impact.saisies).toBe(1)
    expect(await prisma.client.count({ where: { id: d.client.id } })).toBe(0)
    expect(await prisma.mission.count({ where: { clientId: d.client.id } })).toBe(0)
    expect(await prisma.externalLink.count({ where: { provider: DOLIBARR } })).toBe(0)
  })

  it('range un client sans toucher à ses missions', async () => {
    const d = await decor()

    await archiverClient(d.client.id, true)

    expect((await prisma.client.findUniqueOrThrow({ where: { id: d.client.id } })).archived).toBe(
      true,
    )
    expect(await prisma.mission.count({ where: { clientId: d.client.id } })).toBe(1)
  })
})
