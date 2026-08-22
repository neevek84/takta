import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { prisma } from '@/db/client'
import { updateSettings } from '@/services/settings'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry, convertPastForecast } from '@/services/time-entries'
import { enqueueSync, enqueueTimeEntry, flushOutbox, RETENTION_JOURS } from './outbox'
import { listFailedSyncRows, listPendingSyncRows, retrySyncRow } from './queue'
import type { SyncHandler, SyncJob, SyncOutcome } from './types'

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
  await prisma.externalLink.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId: { in: [userId, autreId] } } })
  await prisma.cra.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'BLOCAGE', capacityCentiemes: 100 })
})

afterAll(async () => {
  await prisma.externalLink.deleteMany({})
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

  // `abandon()` fixe `nextAttemptAt` à l'instant de l'échec : une ligne FAILED
  // vieillit donc comme une autre, et une purge qui ne filtre pas l'état
  // l'efface au bout de 90 jours. `core/sync/policy.ts` promet l'inverse mot
  // pour mot — « la ligne reste en base […] une file qui perdrait ses échecs
  // produirait un agenda silencieusement faux ». Sans ce test, la promesse est
  // écrite et jamais vérifiée.
  it('garde une ligne en échec, même périmée', async () => {
    const echec = await prisma.syncOutbox.create({
      data: {
        userId,
        entityType: 'TimeEntry',
        entityId: 'saisie-en-echec',
        provider: 'GOOGLE',
        operation: 'UPSERT',
        state: 'FAILED',
        attempts: 5,
        lastError: 'Agenda injoignable : fetch failed',
        nextAttemptAt: new Date(Date.now() - (RETENTION_JOURS + 1) * 86_400_000),
      },
    })

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })

    expect(await prisma.syncOutbox.findUnique({ where: { id: echec.id } })).not.toBeNull()
    // Le symptôme tel que l'utilisateur le voit : l'écran de supervision.
    expect((await listFailedSyncRows(userId)).map((r) => r.id)).toEqual([echec.id])
  })

  // Une suppression due porte un `ExternalLink` : le bloc existe dans l'agenda,
  // et cette ligne est la seule chose en base qui sache qu'il faut le retirer.
  // L'effacer laisse un bloc fantôme définitif — la saisie, elle, a déjà
  // disparu, donc rien ne remettra jamais la suppression en file.
  it('garde une suppression due, même périmée, tant que son lien externe existe', async () => {
    const perimee = await prisma.syncOutbox.create({
      data: {
        userId,
        entityType: 'TimeEntry',
        entityId: 'saisie-supprimee',
        provider: 'GOOGLE',
        operation: 'DELETE',
        nextAttemptAt: new Date(Date.now() - (RETENTION_JOURS + 1) * 86_400_000),
      },
    })
    await prisma.externalLink.create({
      data: {
        userId,
        entityType: 'TimeEntry',
        entityId: 'saisie-supprimee',
        provider: 'GOOGLE',
        externalId: 'evt-fantome',
      },
    })

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })

    expect(await prisma.syncOutbox.findUnique({ where: { id: perimee.id } })).not.toBeNull()
  })

  // Le pendant du test précédent, et ce qui empêche la protection des
  // suppressions de rouvrir la fuite que la purge existe pour fermer : sans
  // lien externe, la suppression n'a jamais rien poussé, donc rien à retirer.
  // Chaque `clearMonth` d'un compte non connecté frappe des saisies aux `cuid`
  // neufs, donc des lignes de file neuves : les garder toutes ferait grossir
  // la file sans borne, exactement le défaut d'origine.
  it('retire une suppression périmée qui n a jamais rien poussé', async () => {
    const perimee = await prisma.syncOutbox.create({
      data: {
        userId,
        entityType: 'TimeEntry',
        entityId: 'saisie-jamais-poussee',
        provider: 'GOOGLE',
        operation: 'DELETE',
        nextAttemptAt: new Date(Date.now() - (RETENTION_JOURS + 1) * 86_400_000),
      },
    })

    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })

    expect(await prisma.syncOutbox.findUnique({ where: { id: perimee.id } })).toBeNull()
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

describe('les échecs remontent au lieu de disparaître', () => {
  async function echouer(): Promise<string> {
    await saveEntry({ userId, lineId: lineA, date: '2026-03-12', minutes: 240, kind: 'REALISE' })
    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    await prisma.syncOutbox.update({
      where: { id: ligne.id },
      data: { state: 'FAILED', attempts: 5, lastError: 'Agenda injoignable : fetch failed' },
    })
    return ligne.id
  }

  it('liste les lignes en échec avec leur motif et un libellé lisible', async () => {
    await echouer()

    const echecs = await listFailedSyncRows(userId)
    expect(echecs.length).toBe(1)
    expect(echecs[0]?.attempts).toBe(5)
    expect(echecs[0]?.lastError).toContain('Agenda injoignable')
    expect(echecs[0]?.libelle).toContain('2026-03-12')
  })

  it('ne liste pas les lignes encore en attente', async () => {
    await saveEntry({ userId, lineId: lineB, date: '2026-03-13', minutes: 240, kind: 'REALISE' })
    expect(await listFailedSyncRows(userId)).toEqual([])
  })

  it('ne laisse pas voir les échecs d un autre utilisateur', async () => {
    await echouer()
    expect(await listFailedSyncRows(autreId)).toEqual([])
  })

  it('rejoue une ligne en la remettant immédiatement en attente', async () => {
    const id = await echouer()

    expect(await retrySyncRow(id)).toBe(true)

    const ligne = await prisma.syncOutbox.findUniqueOrThrow({ where: { id } })
    expect({ state: ligne.state, attempts: ligne.attempts, lastError: ligne.lastError }).toEqual({
      state: 'PENDING',
      attempts: 0,
      lastError: '',
    })
    expect(ligne.nextAttemptAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('rejoue la ligne de n importe quel compte : la file est d instance', async () => {
    // Arbitrage du porteur, 20 août 2026. La restriction viendra des rôles ;
    // d'ici là une session authentifiée suffit, et c'est assumé.
    const id = await echouer()
    expect(await retrySyncRow(id)).toBe(true)
    expect((await prisma.syncOutbox.findUniqueOrThrow({ where: { id } })).state).toBe('PENDING')
  })

  it('rend false sur une ligne qui n existe pas', async () => {
    expect(await retrySyncRow('ligne-inexistante')).toBe(false)
  })
})

// --------------------------------------------------------------------------
// La file au service d'un fournisseur qui n'est PAS personnel.
//
// Google pousse des événements d'agenda, avec un jeton par personne : la file
// et le fournisseur ont le même propriétaire, et rien n'obligeait jusqu'ici à
// distinguer les deux. Dolibarr reçoit des temps consommés avec une clé d'API
// qui appartient à l'instance (`ownerScope = 'INSTANCE'`) : la ligne de file
// reste personnelle — elle désigne un CRA, qui a un propriétaire — mais le
// fournisseur, lui, ne l'est plus. Tout ce qui suit vérifie que la file ne
// confond pas les deux.
// --------------------------------------------------------------------------

const DOLIBARR = 'DOLIBARR'

const SUCCES: SyncOutcome = { ok: true }
const PANNE: SyncOutcome = { ok: false, retriable: true, message: 'Dolibarr injoignable.' }
const REFUS: SyncOutcome = { ok: false, retriable: false, message: 'Mission non rattachée.' }

function gestionnaire(resultat: SyncOutcome, vus: SyncJob[] = []): SyncHandler {
  return {
    async upsert(job) {
      vus.push(job)
      return resultat
    },
    async remove(job) {
      vus.push(job)
      return resultat
    },
  }
}

function explosif(): SyncHandler {
  return {
    async upsert() {
      throw new Error('boum')
    },
    async remove() {
      throw new Error('boum')
    },
  }
}

function enfiler(args: {
  userId: string
  entityType?: string
  entityId: string
  provider?: string
  operation?: 'UPSERT' | 'DELETE'
  payload?: Record<string, string>
  now?: Date
}): Promise<void> {
  return prisma.$transaction(async (tx) =>
    enqueueSync(tx, {
      userId: args.userId,
      entityType: args.entityType ?? 'Cra',
      entityId: args.entityId,
      provider: args.provider ?? DOLIBARR,
      ...(args.operation === undefined ? {} : { operation: args.operation }),
      ...(args.payload === undefined ? {} : { payload: args.payload }),
      ...(args.now === undefined ? {} : { now: args.now }),
    }),
  )
}

describe('la file ne suppose pas un fournisseur personnel', () => {
  it('met en file une entité qui n est pas une saisie, pour un fournisseur d instance', async () => {
    await enfiler({ userId, entityId: 'cra-1' })

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect({
      entityType: ligne.entityType,
      entityId: ligne.entityId,
      provider: ligne.provider,
      operation: ligne.operation,
      state: ligne.state,
    }).toEqual({
      entityType: 'Cra',
      entityId: 'cra-1',
      provider: DOLIBARR,
      operation: 'UPSERT',
      state: 'PENDING',
    })
  })

  // Le dédoublonnage porte sur le triplet, pas sur la saisie : dix validations
  // successives du même CRA ne laissent qu'une ligne.
  it('dix mises en file sur la même cible produisent une ligne', async () => {
    for (let i = 0; i < 10; i++) await enfiler({ userId, entityId: 'cra-1' })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(1)
  })

  // Le `provider` entre dans la clé d'unicité : deux fournisseurs visant la
  // même entité tiennent chacun leur ligne. Sans cela, armer Dolibarr
  // écraserait la ligne Google de la même cible — et l'agenda ne recevrait
  // jamais rien.
  it('sépare deux fournisseurs sur la même entité', async () => {
    await enfiler({ userId, entityType: 'TimeEntry', entityId: 'e1', provider: 'GOOGLE' })
    await enfiler({ userId, entityType: 'TimeEntry', entityId: 'e1', provider: DOLIBARR })

    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(2)
  })

  it('conserve le contexte de rejeu et le relit tel quel', async () => {
    await enfiler({ userId, entityId: 'cra-1', payload: { month: '2026-05' } })

    const vus: SyncJob[] = []
    await flushOutbox({ userId, handlers: { [DOLIBARR]: gestionnaire(SUCCES, vus) } })

    expect(vus[0]?.payload).toEqual({ month: '2026-05' })
  })

  // La purge est bornée au fournisseur qu'on met en file : valider un CRA vers
  // Dolibarr ne doit pas emporter les vieilles lignes de l'agenda, dont la
  // suppression est justement le défaut que la purge Google existe pour
  // empêcher.
  it('la purge ne franchit pas la frontière du fournisseur', async () => {
    const vieilleGoogle = await prisma.syncOutbox.create({
      data: {
        userId,
        entityType: 'TimeEntry',
        entityId: 'saisie-perimee-google',
        provider: 'GOOGLE',
        operation: 'UPSERT',
        nextAttemptAt: new Date(Date.now() - (RETENTION_JOURS + 1) * 86_400_000),
      },
    })

    await enfiler({ userId, entityId: 'cra-1' })

    expect(await prisma.syncOutbox.findUnique({ where: { id: vieilleGoogle.id } })).not.toBeNull()
  })

  it('la purge ne franchit pas la frontière de l utilisateur', async () => {
    const autre = await prisma.syncOutbox.create({
      data: {
        userId: autreId,
        entityType: 'Cra',
        entityId: 'cra-autre',
        provider: DOLIBARR,
        operation: 'UPSERT',
        nextAttemptAt: new Date(Date.now() - (RETENTION_JOURS + 1) * 86_400_000),
      },
    })

    await enfiler({ userId, entityId: 'cra-1' })

    expect(await prisma.syncOutbox.findUnique({ where: { id: autre.id } })).not.toBeNull()
  })

  // L'écran de supervision est commun aux deux fournisseurs. Il lisait chaque
  // ligne comme une saisie et rendait « Saisie supprimée » pour tout ce qui
  // n'en était pas une — un CRA validé, parfaitement vivant, s'y présentait
  // comme effacé.
  it('l écran de supervision ne présente pas un CRA comme une saisie supprimée', async () => {
    await enfiler({ userId, entityId: 'cra-1' })
    await prisma.syncOutbox.updateMany({
      where: { userId },
      data: { state: 'FAILED', attempts: 5, lastError: 'Dolibarr injoignable' },
    })

    const [echec] = await listFailedSyncRows(userId)
    expect(echec?.provider).toBe(DOLIBARR)
    expect(echec?.libelle).not.toContain('supprimée')
    expect(echec?.libelle).toContain('cra-1')
  })
})

describe('drainage par gestionnaire', () => {
  const T0 = new Date('2026-05-04T10:00:00.000Z')
  const plusTard = (minutes: number) => new Date(T0.getTime() + minutes * 60_000)

  it('supprime la ligne quand le gestionnaire réussit', async () => {
    await enfiler({ userId, entityId: 'cra-1' })

    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire(SUCCES) },
      now: T0,
    })

    expect(rapport).toEqual({ traitees: 1, reussies: 1, replanifiees: 0, echouees: 0 })
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(0)
  })

  it('appelle remove pour une suppression', async () => {
    const vus: SyncJob[] = []
    await enfiler({ userId, entityId: 'cra-1', operation: 'DELETE' })

    await flushOutbox({ userId, handlers: { [DOLIBARR]: gestionnaire(SUCCES, vus) }, now: T0 })
    expect(vus[0]?.operation).toBe('DELETE')
  })

  // Le drainage est scopé sur l'utilisateur comme toute fonction de service :
  // le bouton « synchroniser » d'un compte ne pousse pas les CRA d'un autre.
  it('ne draine pas la file d un autre utilisateur', async () => {
    await enfiler({ userId: autreId, entityId: 'cra-autre' })

    const vus: SyncJob[] = []
    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire(SUCCES, vus) },
      now: T0,
    })

    expect(rapport.traitees).toBe(0)
    expect(vus).toEqual([])
    expect(await prisma.syncOutbox.count({ where: { userId: autreId } })).toBe(1)
  })

  // Un fournisseur non connecté n'a pas de gestionnaire : sa file attend, elle
  // ne tombe pas en échec. Consommer des tentatives ici viderait le quota
  // avant même que l'exploitant ait saisi sa clé d'API.
  it('laisse en attente la ligne d un fournisseur sans gestionnaire', async () => {
    await enfiler({ userId, entityId: 'cra-1' })

    const rapport = await flushOutbox({ userId, handlers: {}, now: T0 })

    expect(rapport.traitees).toBe(0)
    expect((await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })).state).toBe('PENDING')
  })

  it('ne touche pas à la ligne d un fournisseur pour lequel on ne draine pas', async () => {
    await enfiler({ userId, entityType: 'TimeEntry', entityId: 'e1', provider: 'GOOGLE' })
    await enfiler({ userId, entityId: 'cra-1' })

    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire(SUCCES) },
      now: T0,
    })

    expect(rapport.traitees).toBe(1)
    const restantes = await prisma.syncOutbox.findMany({ where: { userId } })
    expect(restantes.map((l) => l.provider)).toEqual(['GOOGLE'])
  })

  // Le filtre sur le fournisseur borne la **lecture**, pas seulement la
  // boucle. Sans lui, les lignes d'un fournisseur non connecté occupent le lot
  // et affament celui qu'on sait pousser : un compte dont l'agenda est
  // déconnecté depuis six mois ne verrait plus un seul CRA partir vers
  // Dolibarr, sans le moindre échec pour le dire.
  it('ne laisse pas un fournisseur sans gestionnaire affamer le lot', async () => {
    await enfiler({
      userId,
      entityType: 'TimeEntry',
      entityId: 'e1',
      provider: 'GOOGLE',
      now: new Date(T0.getTime() - 86_400_000),
    })
    await enfiler({ userId, entityId: 'cra-1', now: T0 })

    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire(SUCCES) },
      limit: 1,
      now: T0,
    })

    expect(rapport.traitees).toBe(1)
    expect((await prisma.syncOutbox.findMany({ where: { userId } })).map((l) => l.provider)).toEqual(
      ['GOOGLE'],
    )
  })

  it('replanifie un échec rejouable selon le recul progressif', async () => {
    await enfiler({ userId, entityId: 'cra-1' })

    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire(PANNE) },
      now: T0,
    })

    expect(rapport).toEqual({ traitees: 1, reussies: 0, replanifiees: 1, echouees: 0 })
    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect(ligne.state).toBe('PENDING')
    expect(ligne.attempts).toBe(1)
    expect(ligne.lastError).toBe('Dolibarr injoignable.')
    expect(ligne.nextAttemptAt.toISOString()).toBe(plusTard(1).toISOString())
  })

  it('passe en échec au bout du quota, sans perdre la ligne', async () => {
    await enfiler({ userId, entityId: 'cra-1' })

    for (let i = 0; i < 5; i++) {
      await flushOutbox({
        userId,
        handlers: { [DOLIBARR]: gestionnaire(PANNE) },
        now: plusTard(i * 1000),
      })
    }

    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect(ligne.state).toBe('FAILED')
    expect(ligne.attempts).toBe(5)
    expect((await listFailedSyncRows(userId)).map((r) => r.id)).toEqual([ligne.id])
  })

  // Une erreur permanente (400, 422 : mission non rattachée, projet effacé)
  // n'est pas rejouée cinq fois. Elle remonte tout de suite à l'écran.
  it('abandonne sans attendre un échec non rejouable', async () => {
    await enfiler({ userId, entityId: 'cra-1' })

    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire(REFUS) },
      now: T0,
    })

    expect(rapport).toEqual({ traitees: 1, reussies: 0, replanifiees: 0, echouees: 1 })
    const ligne = await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })
    expect(ligne.state).toBe('FAILED')
    expect(ligne.attempts).toBe(1)
    expect(ligne.lastError).toBe('Mission non rattachée.')
  })

  it('ne retraite pas une ligne en échec définitif', async () => {
    await enfiler({ userId, entityId: 'cra-1' })
    await flushOutbox({ userId, handlers: { [DOLIBARR]: gestionnaire(REFUS) }, now: T0 })

    const vus: SyncJob[] = []
    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire(SUCCES, vus) },
      now: plusTard(10_000),
    })

    expect(rapport.traitees).toBe(0)
    expect(vus).toEqual([])
  })

  it('ne traite pas une ligne dont le recul n est pas écoulé', async () => {
    await enfiler({ userId, entityId: 'cra-1' })
    await flushOutbox({ userId, handlers: { [DOLIBARR]: gestionnaire(PANNE) }, now: T0 })

    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire(SUCCES) },
      now: plusTard(0.5),
    })
    expect(rapport.traitees).toBe(0)
  })

  // Une exception non prévue d'un gestionnaire ne doit pas interrompre le
  // drainage : elle vaut échec rejouable, et la ligne suivante est traitée.
  it('absorbe une exception du gestionnaire comme un échec rejouable', async () => {
    await enfiler({ userId, entityId: 'cra-1' })

    const rapport = await flushOutbox({ userId, handlers: { [DOLIBARR]: explosif() }, now: T0 })

    expect(rapport).toEqual({ traitees: 1, reussies: 0, replanifiees: 1, echouees: 0 })
    expect((await prisma.syncOutbox.findFirstOrThrow({ where: { userId } })).lastError).toBe('boum')
  })

  it('respecte la limite demandée', async () => {
    for (let i = 0; i < 5; i++) await enfiler({ userId, entityId: `cra-${i}` })

    const rapport = await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire(SUCCES) },
      limit: 2,
      now: T0,
    })

    expect(rapport.traitees).toBe(2)
    expect(await prisma.syncOutbox.count({ where: { userId } })).toBe(3)
  })
})

/**
 * Le catalogue promettait `temps.pousses` et `synchro.echec` à l'abonnement
 * sans que personne ne les émette. L'acte, lui, existe : une ligne de file
 * dont la cible est un CRA porte les temps d'un mois arrêté — `transitionCra`
 * est le seul endroit qui en met en file, et seulement à la validation.
 */
describe('journal de preuve — ce que le drainage générique consigne', () => {
  const NOW = new Date('2026-03-20T10:00:00.000Z')

  it('CONSIGNE `temps.pousses` quand la ligne d un CRA aboutit', async () => {
    await prisma.auditEvent.deleteMany({})
    await enfiler({ userId, entityId: 'cra-journal' })

    await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire({ ok: true }) },
      now: NOW,
    })

    const entrees = await prisma.auditEvent.findMany({ where: { action: 'temps.pousses' } })
    expect(entrees, 'aucune entrée `temps.pousses`').toHaveLength(1)
    expect(entrees[0]!.entityId).toBe('cra-journal')
    expect(entrees[0]!.actorId).toBe(userId)
    const payload = JSON.parse(entrees[0]!.payloadJson) as Record<string, unknown>
    expect(payload.provider).toBe(DOLIBARR)
  })

  it('ne consigne rien pour une cible qui n est pas un CRA', async () => {
    await prisma.auditEvent.deleteMany({})
    await enfiler({ userId, entityType: 'TimeEntry', entityId: 'te-1', provider: 'AUTRE' })

    await flushOutbox({ userId, handlers: { AUTRE: gestionnaire({ ok: true }) }, now: NOW })

    expect(await prisma.auditEvent.count({ where: { action: 'temps.pousses' } })).toBe(0)
  })

  it('CONSIGNE `synchro.echec` à l abandon, et rien à un simple recul', async () => {
    await prisma.auditEvent.deleteMany({})
    await enfiler({ userId, entityId: 'cra-recul' })

    // Rejouable : la ligne recule, personne n'a rien à faire.
    await flushOutbox({
      userId,
      handlers: { [DOLIBARR]: gestionnaire({ ok: false, retriable: true, message: 'panne' }) },
      now: NOW,
    })
    expect(await prisma.auditEvent.count({ where: { action: 'synchro.echec' } })).toBe(0)

    // Définitif : la ligne part en `FAILED`, et cela demande une action.
    await flushOutbox({
      userId,
      handlers: {
        [DOLIBARR]: gestionnaire({ ok: false, retriable: false, message: 'projet inconnu' }),
      },
      now: new Date(NOW.getTime() + 3_600_000),
    })

    const entrees = await prisma.auditEvent.findMany({ where: { action: 'synchro.echec' } })
    expect(entrees, 'aucune entrée `synchro.echec`').toHaveLength(1)
    expect(entrees[0]!.entityId).toBe('cra-recul')
    expect(JSON.parse(entrees[0]!.payloadJson)).toMatchObject({ erreur: 'projet inconnu' })
  })
})

describe('la file en attente, telle que la supervision la montre', () => {
  it('montre la file de toute l instance, et dit à qui chaque ligne est', async () => {
    // Arbitrage du porteur, 20 août 2026 : un CRA appartient à une mission, et
    // le pousser est un acte d'instance — la clé d'API l'est, la
    // correspondance mission → projet l'est. Filtrer sur « qui a créé la
    // ligne » était le mauvais axe. La restriction viendra des rôles.
    await prisma.syncOutbox.deleteMany({ where: { userId: { in: [userId, autreId] } } })
    await prisma.syncOutbox.create({
      data: {
        userId,
        entityType: 'Cra',
        entityId: 'cra-a-moi',
        provider: 'DOLIBARR',
        operation: 'UPSERT',
        state: 'PENDING',
      },
    })
    await prisma.syncOutbox.create({
      data: {
        userId: autreId,
        entityType: 'Cra',
        entityId: 'cra-de-l-autre',
        provider: 'DOLIBARR',
        operation: 'UPSERT',
        state: 'PENDING',
      },
    })

    const toutes = await listPendingSyncRows()
    expect(toutes.map((r) => r.entityId).sort()).toEqual(['cra-a-moi', 'cra-de-l-autre'])
    // Le propriétaire est nommé : c'est ce que les rôles exploiteront demain,
    // et ce qui rend la liste lisible dès qu'il y a deux comptes.
    expect(new Set(toutes.map((r) => r.proprietaire)).size).toBe(2)
  })

  it('écarte ce qui a échoué : les échecs ont leur propre écran', async () => {
    await prisma.syncOutbox.deleteMany({ where: { userId } })
    await prisma.syncOutbox.create({
      data: {
        userId,
        entityType: 'Cra',
        entityId: 'cra-echoue',
        provider: 'DOLIBARR',
        operation: 'UPSERT',
        state: 'FAILED',
        lastError: 'refus',
      },
    })

    expect(await listPendingSyncRows()).toEqual([])
  })

  it('dit depuis combien de temps la plus ancienne attend', async () => {
    // C'est ce chiffre, et lui seul, qui revele qu'aucun drainage ne tourne.
    await prisma.syncOutbox.deleteMany({ where: { userId } })
    await prisma.syncOutbox.create({
      data: {
        userId,
        entityType: 'Cra',
        entityId: 'cra-vieux',
        provider: 'DOLIBARR',
        operation: 'UPSERT',
        state: 'PENDING',
        updatedAt: new Date(Date.now() - 30 * 3_600_000),
      },
    })

    const [ligne] = await listPendingSyncRows()
    expect(ligne?.attenteHeures).toBe(30)
  })
})
