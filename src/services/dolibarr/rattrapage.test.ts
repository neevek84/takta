import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { ENTITY_CRA } from '@/core/sync/policy'
import { createClient } from '@/services/clients'
import { createLine, createMission } from '@/services/missions'
import { saveInstanceCredential, revokeInstanceCredential } from '@/services/credentials'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { DOLIBARR } from './api'
import { attachMission } from './import'
import { rattraperCraValides } from './rattrapage'

let userId = ''
let autreId = ''
let clientId = ''
let missionId = ''
let lineId = ''
/** Seconde mission du même client, rattachée elle aussi. */
let autreMissionId = ''

const PROJET = 42
const AUTRE_PROJET = 43

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  userId = (
    await prisma.user.create({
      data: { email: 'rattrapage@test.local', name: 'T', passwordHash: 'x' },
    })
  ).id
  autreId = (
    await prisma.user.create({
      data: { email: 'rattrapage-autre@test.local', name: 'A', passwordHash: 'x' },
    })
  ).id

  const c = await createClient('RATTRAPAGE client')
  clientId = c.id
  missionId = (await createMission({ clientId, label: 'RATTRAPAGE mission' })).id
  lineId = (
    await createLine({
      missionId,
      userId,
      label: 'Développement',
      soldCentiemes: 3000,
      tjmCents: 80_000,
    })
  ).id
  autreMissionId = (await createMission({ clientId, label: 'RATTRAPAGE mission bis' })).id
  await createLine({
    missionId: autreMissionId,
    userId,
    label: 'Maintenance',
    soldCentiemes: 3000,
    tjmCents: 80_000,
  })
  await prisma.assignment.create({ data: { lineId, userId: autreId, soldCentiemes: 3000 } })
})

beforeEach(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.cra.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await revokeInstanceCredential(DOLIBARR)
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.cra.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await revokeInstanceCredential(DOLIBARR)
  await prisma.user.deleteMany({
    where: { email: { in: ['rattrapage@test.local', 'rattrapage-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'RATTRAPAGE client' } })
  await prisma.$disconnect()
})

async function connecter(): Promise<void> {
  await saveInstanceCredential({
    provider: DOLIBARR,
    secret: 'cle-de-test',
    baseUrl: 'https://dolibarr.invalid/api/index.php',
    metadata: { dolibarrUserId: '7' },
  })
}

async function rattacher(mission = missionId, projet = PROJET): Promise<void> {
  await prisma.externalLink.create({
    data: {
      userId,
      entityType: 'Mission',
      entityId: mission,
      provider: DOLIBARR,
      externalId: String(projet),
    },
  })
}

/** Un CRA validé, comme le porteur en a déjà des mois entiers avant tout ça. */
async function craValide(month: string, mission = missionId, owner = userId): Promise<string> {
  const cra = await getOrCreateCra(owner, mission, month)
  await transitionCra(owner, cra.id, 'ENVOYER')
  await transitionCra(owner, cra.id, 'VALIDER')
  return cra.id
}

function enFile(): Promise<Array<{ entityId: string; userId: string }>> {
  return prisma.syncOutbox.findMany({
    where: { provider: DOLIBARR, entityType: ENTITY_CRA },
    select: { entityId: true, userId: true },
  })
}

describe('rattrapage des CRA validés', () => {
  // Le défaut : on saisit, on valide ses mois, PUIS on découvre l'écran
  // Administration · Dolibarr. Tout ce qui précède restait dehors, sans un mot.
  it('met en file les CRA validés AVANT que Dolibarr soit connecté', async () => {
    const mai = await craValide('2026-05')
    const juin = await craValide('2026-06')
    expect(await enFile()).toHaveLength(0)

    await connecter()
    await rattacher()

    expect(await rattraperCraValides()).toBe(2)
    expect((await enFile()).map((l) => l.entityId).sort()).toEqual([mai, juin].sort())
  })

  // Second visage du même défaut : Dolibarr était connecté, mais la mission
  // n'était pas encore rattachée à son projet — l'armement exige les deux.
  it('met en file les CRA validés avant le rattachement de la mission', async () => {
    await connecter()
    const mai = await craValide('2026-05')
    expect(await enFile()).toHaveLength(0)

    await rattacher()

    expect(await rattraperCraValides(missionId)).toBe(1)
    expect((await enFile()).map((l) => l.entityId)).toEqual([mai])
  })

  it('ne met en file ni brouillon, ni envoyé, ni refusé', async () => {
    await connecter()
    await rattacher()
    const brouillon = await getOrCreateCra(userId, missionId, '2026-05')
    const envoye = await getOrCreateCra(userId, autreMissionId, '2026-05')
    await rattacher(autreMissionId, AUTRE_PROJET)
    await transitionCra(userId, envoye.id, 'ENVOYER')

    expect(await rattraperCraValides()).toBe(0)
    expect(await enFile()).toHaveLength(0)
    expect(brouillon.status).toBe('BROUILLON')
  })

  // Une ligne de file part sous le compte de son propriétaire, jamais sous
  // celui de qui a cliqué : c'est ce `userId` que le drainage relit pour ne
  // pousser que ses saisies.
  it('inscrit chaque CRA sous SON propriétaire, pas sous l appelant', async () => {
    await connecter()
    const sien = await craValide('2026-05', missionId, autreId)
    await rattacher()

    expect(await rattraperCraValides()).toBe(1)
    expect(await enFile()).toEqual([{ entityId: sien, userId: autreId }])
  })

  it('ne touche pas aux missions qui ne sont rattachées à aucun projet', async () => {
    await connecter()
    await craValide('2026-05')
    const horsProjet = await craValide('2026-05', autreMissionId)
    await rattacher()

    await rattraperCraValides()

    expect((await enFile()).map((l) => l.entityId)).not.toContain(horsProjet)
  })

  // Le rattrapage se rejoue à chaque connexion et à chaque rattachement :
  // recompter le même travail annoncerait un rattrapage qui n'a pas eu lieu.
  it('ne recompte pas un CRA déjà en file', async () => {
    await connecter()
    await craValide('2026-05')
    await rattacher()

    expect(await rattraperCraValides()).toBe(1)
    expect(await rattraperCraValides()).toBe(0)
    expect(await enFile()).toHaveLength(1)
  })

  it('ne remet pas en file un CRA déjà poussé et toujours mappé', async () => {
    await connecter()
    await craValide('2026-05')
    await rattacher()
    const mai = (await getOrCreateCra(userId, missionId, '2026-05')).id
    await prisma.syncOutbox.deleteMany({})
    await prisma.externalLink.create({
      data: {
        userId,
        entityType: 'CraTimeSpent',
        entityId: `${mai}|${lineId}|2026-05-04|`,
        provider: DOLIBARR,
        externalId: '55:77',
        syncState: 'SYNCED',
      },
    })

    expect(await rattraperCraValides()).toBe(0)
    expect(await enFile()).toHaveLength(0)
  })

  // L'application est autoportante : sans Dolibarr, rien ne doit entrer dans
  // une file que personne ne draine.
  it('n inscrit rien tant que Dolibarr n est pas connecté', async () => {
    await rattacher()
    await craValide('2026-05')

    expect(await rattraperCraValides()).toBe(0)
    expect(await enFile()).toHaveLength(0)
  })

  // Le rattachement d'un projet est l'un des deux instants où l'armement
  // change : il doit rattraper de lui-même, sans que l'écran ait à y penser.
  it('le rattachement d une mission rattrape ses CRA validés', async () => {
    await connecter()
    const mai = await craValide('2026-05')

    const r = await attachMission({
      userId,
      missionId,
      dolibarrProjectId: PROJET,
      projectRef: 'PJ042',
      projectSocid: null,
    })

    expect(r.craRattrapes).toBe(1)
    expect((await enFile()).map((l) => l.entityId)).toEqual([mai])
  })
})
