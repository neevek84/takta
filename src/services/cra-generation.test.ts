import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { genererCra } from './cra-generation'
import { currentAuditSeq, readAuditSince } from './audit'

/**
 * Un interrupteur pour provoquer, réellement, l'échec précis que le test
 * d'atomicité doit démontrer : celui de la création du CRA elle-même,
 * **après** que le prévisionnel a déjà été traité dans la même transaction.
 *
 * `annulerPrevisionnelDuMois` fait d'abord son vrai travail (délégué à
 * l'implémentation réelle), puis — seulement si l'interrupteur est armé —
 * supprime la mission **dans la même transaction** (`tx`, jamais `prisma`).
 * `tx.cra.create`, appelé juste après par `genererCra`, référence alors une
 * mission qui n'existe plus dans cette transaction : une vraie violation de
 * contrainte de clé étrangère, pas une forme de mock qu'on interroge après
 * coup. La supprimer plus tôt (avant l'appel à `genererCra`) aurait cascadé
 * sur la ligne et rendu la prestation introuvable — `NON_AFFECTE`, pas la
 * panne de création qu'on veut provoquer ; elle doit donc tomber ici, entre
 * les deux étapes exactes que la tâche demande d'observer.
 */
const echecApresPrevisionnel = vi.hoisted(() => ({ actif: false }))

vi.mock('./cra-previsionnel', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./cra-previsionnel')>()
  return {
    ...reel,
    annulerPrevisionnelDuMois: async (
      tx: Parameters<typeof reel.annulerPrevisionnelDuMois>[0],
      args: Parameters<typeof reel.annulerPrevisionnelDuMois>[1],
    ) => {
      const compte = await reel.annulerPrevisionnelDuMois(tx, args)
      if (echecApresPrevisionnel.actif) {
        await tx.mission.delete({ where: { id: args.missionId } })
      }
      return compte
    },
  }
})

let userId = ''
let userId2 = ''
let clientId = ''
let missionId = ''
let lineId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'gen@test.local', name: 'G', passwordHash: 'x' },
  })
  userId = u.id
  const u2 = await prisma.user.create({
    data: { email: 'gen2@test.local', name: 'G2', passwordHash: 'x' },
  })
  userId2 = u2.id
})

beforeEach(async () => {
  echecApresPrevisionnel.actif = false
  await prisma.syncOutbox.deleteMany({})
  await prisma.client.deleteMany({ where: { name: { startsWith: 'GEN' } } })
  const client = await createClient('GEN Client')
  clientId = client.id
  const mission = await createMission({ clientId, label: 'GEN Mission' })
  missionId = mission.id
  const ligne = await createLine({
    missionId,
    label: 'Consultant',
    userId,
    soldCentiemes: 3000,
    tjmCents: 0,
  })
  lineId = ligne.id
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.client.deleteMany({ where: { name: { startsWith: 'GEN' } } })
  await prisma.user.deleteMany({ where: { email: { in: ['gen@test.local', 'gen2@test.local'] } } })
  await prisma.$disconnect()
})

async function saisirSur(
  cibleLineId: string,
  date: string,
  kind: 'REALISE' | 'PREVISIONNEL',
): Promise<string> {
  const e = await prisma.timeEntry.create({
    data: {
      lineId: cibleLineId,
      userId,
      date: new Date(`${date}T00:00:00.000Z`),
      minutes: 420,
      minutesParJour: 420,
      kind,
      slotId: kind,
      startMinute: kind === 'REALISE' ? 540 : 600,
    },
  })
  return e.id
}

async function saisir(date: string, kind: 'REALISE' | 'PREVISIONNEL'): Promise<string> {
  return saisirSur(lineId, date, kind)
}

function monthStart(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`)
}

/**
 * Le mois en cours, premier et dernier jour. `validerPrevisionnelDuMois`
 * convertit aussi bien l'échu que l'à venir, ce qu'un mois figé dans le passé
 * ne démontrerait pas — voir `cra-previsionnel.test.ts`.
 */
function moisCourant(): { month: string; premier: string; dernier: string } {
  const maintenant = new Date()
  const annee = maintenant.getUTCFullYear()
  const mois = maintenant.getUTCMonth() + 1
  const dernierJour = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  const mm = String(mois).padStart(2, '0')
  return {
    month: `${annee}-${mm}`,
    premier: `${annee}-${mm}-01`,
    dernier: `${annee}-${mm}-${String(dernierJour).padStart(2, '0')}`,
  }
}

describe('genererCra', () => {
  it('ouvre un CRA et rend son identifiant', async () => {
    const r = await genererCra(userId, { lineId, month: '2026-03', previsionnel: 'SUPPRIMER' })

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('inattendu')
    const cra = await prisma.cra.findUnique({ where: { id: r.craId } })
    expect(cra).not.toBeNull()
    expect(cra?.missionId).toBe(missionId)
    expect(cra?.userId).toBe(userId)
    expect(cra?.status).toBe('BROUILLON')
  })

  it('VALIDER convertit tout le prévisionnel du mois, échu et à venir, pour cette mission seulement', async () => {
    const { month, premier, dernier } = moisCourant()
    await saisir(premier, 'PREVISIONNEL')
    await saisir(dernier, 'PREVISIONNEL')

    const autreMission = await createMission({ clientId, label: 'GEN Autre mission' })
    const autreLigne = await createLine({
      missionId: autreMission.id,
      label: 'Consultant',
      userId,
      soldCentiemes: 3000,
      tjmCents: 0,
    })
    const ailleurs = await saisirSur(autreLigne.id, premier, 'PREVISIONNEL')

    const r = await genererCra(userId, { lineId, month, previsionnel: 'VALIDER' })

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('inattendu')
    expect(r.previsionnelTraite).toBe(2)

    const entrees = await prisma.timeEntry.findMany({ where: { lineId }, select: { kind: true } })
    expect(entrees).toHaveLength(2)
    expect(entrees.every((e) => e.kind === 'REALISE')).toBe(true)

    const autre = await prisma.timeEntry.findUnique({ where: { id: ailleurs } })
    expect(autre?.kind).toBe('PREVISIONNEL')
  })

  it('SUPPRIMER efface le prévisionnel du mois et met chaque entrée en file DELETE', async () => {
    const { month, premier, dernier } = moisCourant()
    const id1 = await saisir(premier, 'PREVISIONNEL')
    const id2 = await saisir(dernier, 'PREVISIONNEL')

    const r = await genererCra(userId, { lineId, month, previsionnel: 'SUPPRIMER' })

    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('inattendu')
    expect(r.previsionnelTraite).toBe(2)

    const restantes = await prisma.timeEntry.findMany({ where: { lineId } })
    expect(restantes).toHaveLength(0)

    const enFile = await prisma.syncOutbox.findMany({
      where: { entityType: 'TimeEntry', entityId: { in: [id1, id2] }, operation: 'DELETE' },
    })
    expect(enFile).toHaveLength(2)
  })

  it('refuse quand le CRA du mois est déjà validé, et laisse chaque saisie intacte', async () => {
    const { month, premier, dernier } = moisCourant()
    const previsionnelId = await saisir(premier, 'PREVISIONNEL')
    const realiseId = await saisir(dernier, 'REALISE')
    const craValide = await prisma.cra.create({
      data: { missionId, userId, month: monthStart(month), status: 'VALIDE' },
    })

    const r = await genererCra(userId, { lineId, month, previsionnel: 'VALIDER' })

    expect(r).toEqual({ ok: false, raison: 'MOIS_VALIDE', craId: craValide.id })

    const previsionnelEntry = await prisma.timeEntry.findUnique({ where: { id: previsionnelId } })
    expect(previsionnelEntry?.kind).toBe('PREVISIONNEL')
    const realiseEntry = await prisma.timeEntry.findUnique({ where: { id: realiseId } })
    expect(realiseEntry?.kind).toBe('REALISE')

    const enFile = await prisma.syncOutbox.findMany({
      where: { entityType: 'TimeEntry', entityId: previsionnelId },
    })
    expect(enFile).toHaveLength(0)
  })

  it("refuse une prestation à laquelle l'utilisateur n'est pas affecté, et ne touche à rien", async () => {
    const { month, premier } = moisCourant()
    const id = await saisir(premier, 'PREVISIONNEL')

    const r = await genererCra(userId2, { lineId, month, previsionnel: 'VALIDER' })

    expect(r).toEqual({ ok: false, raison: 'NON_AFFECTE' })

    const entry = await prisma.timeEntry.findUnique({ where: { id } })
    expect(entry?.kind).toBe('PREVISIONNEL')
    const cra = await prisma.cra.findFirst({ where: { missionId, userId: userId2 } })
    expect(cra).toBeNull()
  })

  it.each(['BROUILLON', 'ENVOYE', 'REFUSE'])(
    "quand le CRA du mois existe déjà en %s, procède et rend l'identifiant existant",
    async (status) => {
      const { month, premier } = moisCourant()
      const id = await saisir(premier, 'PREVISIONNEL')
      const existant = await prisma.cra.create({
        data: { missionId, userId, month: monthStart(month), status },
      })

      const r = await genererCra(userId, { lineId, month, previsionnel: 'VALIDER' })

      expect(r).toEqual({ ok: true, craId: existant.id, previsionnelTraite: 1 })
      const entry = await prisma.timeEntry.findUnique({ where: { id } })
      expect(entry?.kind).toBe('REALISE')
    },
  )

  it('consigne la conversion sous previsionnel.converti, et l’ouverture du CRA sous cra.ouvert', async () => {
    const { month, premier } = moisCourant()
    await saisir(premier, 'PREVISIONNEL')
    const avant = await currentAuditSeq()

    const r = await genererCra(userId, { lineId, month, previsionnel: 'VALIDER' })
    if (!r.ok) throw new Error('inattendu')

    const apres = await readAuditSince({ since: avant })
    expect(apres.some((e) => e.action === 'previsionnel.converti' && e.entityId === month)).toBe(
      true,
    )
    expect(apres.some((e) => e.action === 'cra.ouvert' && e.entityId === r.craId)).toBe(true)
  })

  it('consigne la suppression sous previsionnel.supprime', async () => {
    const { month, premier } = moisCourant()
    await saisir(premier, 'PREVISIONNEL')
    const avant = await currentAuditSeq()

    await genererCra(userId, { lineId, month, previsionnel: 'SUPPRIMER' })

    const apres = await readAuditSince({ since: avant })
    expect(apres.some((e) => e.action === 'previsionnel.supprime' && e.entityId === month)).toBe(
      true,
    )
  })

  it('ne consigne rien pour le prévisionnel quand le mois n’en portait aucun', async () => {
    const { month, premier } = moisCourant()
    await saisir(premier, 'REALISE')
    const avant = await currentAuditSeq()

    const r = await genererCra(userId, { lineId, month, previsionnel: 'VALIDER' })
    if (!r.ok) throw new Error('inattendu')
    expect(r.previsionnelTraite).toBe(0)

    const apres = await readAuditSince({ since: avant })
    expect(
      apres.some((e) => e.action === 'previsionnel.converti' || e.action === 'previsionnel.supprime'),
    ).toBe(false)
    // Mais l'ouverture du CRA, elle, est un acte réel et se consigne toujours.
    expect(apres.some((e) => e.action === 'cra.ouvert' && e.entityId === r.craId)).toBe(true)
  })

  it("n'a rien laissé derrière lui quand la création échoue", async () => {
    const { month, premier } = moisCourant()
    const id = await saisir(premier, 'PREVISIONNEL')
    const avant = await currentAuditSeq()

    // L'échec est provoqué *après* que le prévisionnel a déjà été traité,
    // dans la même transaction — voir le commentaire du mock plus haut.
    echecApresPrevisionnel.actif = true
    await expect(
      genererCra(userId, { lineId, month, previsionnel: 'SUPPRIMER' }),
    ).rejects.toThrow()
    echecApresPrevisionnel.actif = false

    // La transaction a tout annulé, y compris la suppression de la mission
    // qui a servi à provoquer l'échec de la création : si ce n'était pas le
    // cas, la mission aurait disparu pour de bon.
    const mission = await prisma.mission.findUnique({ where: { id: missionId } })
    expect(mission).not.toBeNull()

    const entry = await prisma.timeEntry.findUnique({ where: { id } })
    expect(entry?.kind).toBe('PREVISIONNEL')

    const cra = await prisma.cra.findFirst({
      where: { missionId, userId, month: monthStart(month) },
    })
    expect(cra).toBeNull()

    const enFile = await prisma.syncOutbox.findMany({
      where: { entityType: 'TimeEntry', entityId: id },
    })
    expect(enFile).toHaveLength(0)

    const apres = await readAuditSince({ since: avant })
    expect(apres).toHaveLength(0)
  })
})
