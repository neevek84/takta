import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry, convertPastForecast } from '@/services/time-entries'
import { enqueueTimeEntry, RETENTION_JOURS } from './outbox'

// Un interrupteur pour faire échouer la mise en file à la demande. C'est le
// seul moyen d'observer le sens « pas d'écriture sans mise en file » : la
// suite du dessus prouve l'inverse (« pas de mise en file sans écriture »),
// mais une mise en file simplement déplacée *après* la transaction la laisse
// entièrement verte. Sans cet interrupteur, aucun test ne tombe quand le
// couplage disparaît — et c'est pourtant tout l'objet de la tâche.
const file = vi.hoisted(() => ({ indisponible: false }))

vi.mock('@/services/sync/outbox', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./outbox')>()
  return {
    ...reel,
    enqueueTimeEntry: async (...args: Parameters<typeof reel.enqueueTimeEntry>) => {
      if (file.indisponible) throw new Error('file indisponible')
      await reel.enqueueTimeEntry(...args)
    },
  }
})

let userId = ''
let autreId = ''
let missionId = ''
let lineA = ''
let lineB = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'outbox@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'outbox-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id

  const c = await createClient('OUTBOX client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  lineA = (await createLine({ missionId, userId, label: 'A', soldCentiemes: 3000, tjmCents: 0 })).id
  lineB = (await createLine({ missionId, userId, label: 'B', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  file.indisponible = false
  await prisma.syncOutbox.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreId] } } })
  await prisma.cra.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
})

afterAll(async () => {
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({
    where: { email: { in: ['outbox@test.local', 'outbox-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'OUTBOX client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('mise en file', () => {
  // Le test central : la file est un ensemble, pas un journal.
  it('dix écritures sur la même cellule produisent une ligne', async () => {
    for (let i = 1; i <= 10; i++) {
      await saveEntry({
        userId,
        lineId: lineA,
        date: '2026-03-12',
        minutes: i * 30,
        kind: 'REALISE',
      })
    }

    const file = await prisma.syncOutbox.findMany({ where: { userId } })
    expect(file.length).toBe(1)
    expect(file[0]?.operation).toBe('UPSERT')
  })

  it('sépare deux cellules distinctes', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineB, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(2)
  })

  it('cible la saisie écrite, avec le bon fournisseur', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    const entry = await prisma.timeEntry.findFirstOrThrow({ where: { userId, lineId: lineA } })
    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })

    expect({
      entityType: ligne.entityType,
      entityId: ligne.entityId,
      provider: ligne.provider,
      userId: ligne.userId,
    }).toEqual({
      entityType: 'TimeEntry',
      entityId: entry.id,
      provider: 'GOOGLE',
      userId,
    })
  })

  it('bascule en DELETE sans créer de seconde ligne', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })

    const file = await prisma.syncOutbox.findMany({ where: { userId } })
    expect(file.length).toBe(1)
    expect(file[0]?.operation).toBe('DELETE')
  })

  it('remet la ligne en attente après un échec quand la cellule est réécrite', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    await prisma.syncOutbox.updateMany({
      where: { userId },
      data: { state: 'FAILED', attempts: 5, lastError: 'Agenda injoignable' },
    })

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({ state: ligne.state, attempts: ligne.attempts, lastError: ligne.lastError }).toEqual({
      state: 'PENDING',
      attempts: 0,
      lastError: '',
    })
  })

  it('ne met rien en file quand une suppression ne trouve rien à supprimer', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 0, kind: 'REALISE' })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('met en file chaque saisie convertie', async () => {
    await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-10',
      minutes: 240,
      kind: 'PREVISIONNEL',
    })
    await saveEntry({
      userId,
      lineId: lineB,
      date: '2026-03-11',
      minutes: 240,
      kind: 'PREVISIONNEL',
    })
    await prisma.syncOutbox.deleteMany({})

    const r = await convertPastForecast(userId, '2026-03', '2026-03-20')
    expect(r.converted).toBe(2)
    expect(await prisma.syncOutbox.count({ where: { userId, operation: 'UPSERT' } })).toBe(2)
  })
})

describe('la file reste bornée', () => {
  // Sans borne, un utilisateur qui n'active jamais l'agenda accumule une ligne
  // par cellule saisie, indéfiniment : personne ne les draine, rien ne les
  // retire. Une ligne due depuis des mois ne décrit plus rien d'exploitable.
  function vieilleLigne(pourUserId: string, entityId: string) {
    return prisma.syncOutbox.create({
      data: {
        userId: pourUserId,
        entityType: 'TimeEntry',
        entityId,
        provider: 'GOOGLE',
        operation: 'UPSERT',
        nextAttemptAt: new Date(Date.now() - (RETENTION_JOURS + 1) * 86_400_000),
      },
    })
  }

  it('la saisie suivante retire les lignes que plus rien ne drainera', async () => {
    const perimee = await vieilleLigne(userId, 'saisie-perimee')

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })

    expect(await prisma.syncOutbox.findUnique({ where: { id: perimee.id } })).toBeNull()
  })

  it('ne touche pas à la file d un autre utilisateur', async () => {
    const autre = await vieilleLigne(autreId, 'saisie-perimee-autre')

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })

    expect(await prisma.syncOutbox.findUnique({ where: { id: autre.id } })).not.toBeNull()
  })

  it('garde une ligne encore fraîche, même en échec', async () => {
    const recente = await prisma.syncOutbox.create({
      data: {
        userId,
        entityType: 'TimeEntry',
        entityId: 'saisie-recente',
        provider: 'GOOGLE',
        operation: 'UPSERT',
        state: 'FAILED',
        attempts: 5,
        nextAttemptAt: new Date(Date.now() - 86_400_000),
      },
    })

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })

    expect(await prisma.syncOutbox.findUnique({ where: { id: recente.id } })).not.toBeNull()
  })
})

describe('une écriture refusée ne met rien en file', () => {
  it('mois verrouillé', async () => {
    await prisma.cra.create({
      data: { missionId, userId, month: new Date('2026-03-01T00:00:00Z'), status: 'VALIDE' },
    })

    const r = await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-12',
      minutes: 240,
      kind: 'REALISE',
    })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('capacité dépassée en mode BLOCAGE', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 480, kind: 'REALISE' })
    await prisma.syncOutbox.deleteMany({})

    const r = await saveEntry({
      userId,
      lineId: lineB,
      date: '2026-03-12',
      minutes: 240,
      kind: 'REALISE',
    })
    expect(r.ok).toBe(false)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('ligne non affectée', async () => {
    const r = await saveEntry({
      userId: autreId,
      lineId: lineA,
      date: '2026-03-12',
      minutes: 240,
      kind: 'REALISE',
    })
    expect(r).toEqual({ ok: false, reason: 'NON_AFFECTE' })
    expect(await prisma.syncOutbox.count()).toBe(0)
  })
})

describe('la mise en file est transactionnelle avec l écriture', () => {
  // Une écriture qui réussirait sans être mise en file produirait un agenda
  // silencieusement faux ; l'inverse pousserait un bloc pour une saisie qui
  // n'existe pas. Les deux tiennent dans la même transaction, ou aucune.
  it('une transaction interrompue ne laisse ni saisie ni ligne en file', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const e = await tx.timeEntry.create({
          data: {
            lineId: lineA,
            userId,
            date: new Date('2026-03-13T00:00:00.000Z'),
            minutes: 240,
            kind: 'REALISE',
            minutesParJour: 480,
          },
        })
        await enqueueTimeEntry(tx, { userId, entryId: e.id, operation: 'UPSERT' })
        throw new Error('interruption')
      }),
    ).rejects.toThrow('interruption')

    expect(
      await prisma.timeEntry.count({
        where: { userId, date: new Date('2026-03-13T00:00:00.000Z') },
      }),
    ).toBe(0)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  // Le sens que les autres tests ne couvrent pas : une mise en file qui échoue
  // doit emporter l'écriture avec elle. Déplacer l'appel après la transaction
  // fait tomber ces trois-là, et eux seuls.
  it("une mise en file en échec annule l'écriture de la saisie", async () => {
    file.indisponible = true

    await expect(
      saveEntry({ userId, lineId: lineA, date: '2026-03-14', minutes: 240, kind: 'REALISE' }),
    ).rejects.toThrow('file indisponible')

    expect(
      await prisma.timeEntry.count({
        where: { userId, date: new Date('2026-03-14T00:00:00.000Z') },
      }),
    ).toBe(0)
  })

  it('une mise en file en échec annule la suppression de la saisie', async () => {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-14', minutes: 240, kind: 'REALISE' })
    file.indisponible = true

    await expect(
      saveEntry({ userId, lineId: lineA, date: '2026-03-14', minutes: 0, kind: 'REALISE' }),
    ).rejects.toThrow('file indisponible')

    expect(
      await prisma.timeEntry.count({
        where: { userId, date: new Date('2026-03-14T00:00:00.000Z') },
      }),
    ).toBe(1)
  })

  it('une mise en file en échec annule la conversion du prévisionnel', async () => {
    await saveEntry({
      userId,
      lineId: lineA,
      date: '2026-03-10',
      minutes: 240,
      kind: 'PREVISIONNEL',
    })
    file.indisponible = true

    await expect(convertPastForecast(userId, '2026-03', '2026-03-20')).rejects.toThrow(
      'file indisponible',
    )

    expect(await prisma.timeEntry.count({ where: { userId, kind: 'PREVISIONNEL' } })).toBe(1)
  })
})
