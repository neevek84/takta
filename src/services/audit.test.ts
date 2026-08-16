import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { GENESIS_HASH, hashAuditEntry } from '@/core/audit/chain'
import {
  ACTEUR_SYSTEME,
  actorOf,
  appendAudit,
  currentAuditSeq,
  listAuditEvents,
  readAuditSince,
  verifyJournalChain,
} from './audit'

let userId = ''
let autreId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'audit@test.local', name: 'Keveen', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'audit-autre@test.local', name: 'Autre', passwordHash: 'x' },
  })
  autreId = a.id
})

beforeEach(async () => {
  await prisma.auditEvent.deleteMany({})
})

afterAll(async () => {
  await prisma.auditEvent.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['audit@test.local', 'audit-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

function ajout(patch: Partial<Parameters<typeof appendAudit>[0]> = {}) {
  return appendAudit({
    action: 'cra.valide',
    entityType: 'Cra',
    entityId: 'cra_1',
    actorId: userId,
    actorLabel: 'Keveen',
    payload: { month: '2026-07' },
    ...patch,
  })
}

describe('ajout au journal', () => {
  it('ancre la première entrée à la genèse', async () => {
    const e = await ajout()
    expect(e.seq).toBe(1)
    expect(e.prevHash).toBe(GENESIS_HASH)
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('chaîne chaque entrée à la précédente', async () => {
    const a = await ajout()
    const b = await ajout({ entityId: 'cra_2' })
    expect(b.seq).toBe(2)
    expect(b.prevHash).toBe(a.hash)
  })

  it('calcule une empreinte que le module pur retrouve', async () => {
    const e = await ajout()
    expect(
      hashAuditEntry({
        seq: e.seq,
        occurredAtIso: e.occurredAt.toISOString(),
        actorId: e.actorId,
        actorLabel: e.actorLabel,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        payloadJson: JSON.stringify(e.payload),
        prevHash: e.prevHash,
      }),
    ).toBe(e.hash)
  })

  it('restitue la charge utile telle qu elle a été confiée', async () => {
    const e = await ajout({ payload: { month: '2026-07', minutes: 480, verrouille: false } })
    expect(e.payload).toEqual({ month: '2026-07', minutes: 480, verrouille: false })
  })

  it('refuse une action hors catalogue', async () => {
    // @ts-expect-error le type interdit déjà la valeur ; la garde protège
    // les appelants non typés (script de reprise, futur endpoint).
    await expect(ajout({ action: 'cra.validee' })).rejects.toThrow(/catalogue/i)
  })

  it('accepte un acte du système', async () => {
    const e = await appendAudit({
      action: 'travail.echoue',
      entityType: 'ScheduledJob',
      entityId: 'journal.verification',
      ...ACTEUR_SYSTEME,
      payload: { erreur: 'rupture' },
    })
    expect(e.actorId).toBe('')
    expect(e.actorLabel).toBe('SYSTEME')
  })

  it('garde un seq strictement croissant sous écritures concurrentes', async () => {
    // Vingt ajouts lancés ensemble : ni doublon, ni trou, ni fourche.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => ajout({ entityId: `cra_${i}` })),
    )

    const seqs = (
      await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' }, select: { seq: true } })
    ).map((r) => r.seq)

    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
    expect(await verifyJournalChain()).toEqual({ ok: true, verifiees: 20 })
  })
})

describe('aucun secret au journal', () => {
  it('efface un jeton porté par la charge utile', async () => {
    // Le journal est conservé, exporté, poussé vers des URL tierces : un
    // secret qui y entre en ressort partout. La rédaction est au point
    // d'écriture, jamais à l'affichage — un journal déjà écrit ne se rattrape
    // pas.
    const e = await ajout({
      payload: {
        message: 'api_key=Zk29QpLmXv71TbRw03Ns rejetee par Dolibarr',
        entete: 'Bearer aBcD1234EfGh5678IjKl9012',
      },
    })

    expect(JSON.stringify(e.payload)).not.toContain('Zk29QpLmXv71TbRw03Ns')
    expect(JSON.stringify(e.payload)).not.toContain('aBcD1234EfGh5678IjKl9012')
    // Le nom, lui, survit : c'est lui qui rend la panne diagnosticable.
    expect(String(e.payload.message)).toContain('api_key')
  })

  it('descend dans les objets et les tableaux imbriqués', async () => {
    const e = await ajout({
      payload: { detail: { entetes: ['authorization=Zk29QpLmXv71TbRw03Ns'] } },
    })
    expect(JSON.stringify(e.payload)).not.toContain('Zk29QpLmXv71TbRw03Ns')
  })

  it('laisse intacts les identifiants et les libellés ordinaires', async () => {
    // Une rédaction qui mange les cuid rendrait le journal illisible : on ne
    // saurait plus de quelle ligne, de quel mois ni de quel client on parle.
    const e = await ajout({
      payload: { lineId: 'clx8q2v9d0001abcdefghijkl', month: '2026-07', name: 'ACME 38' },
    })
    expect(e.payload).toEqual({
      lineId: 'clx8q2v9d0001abcdefghijkl',
      month: '2026-07',
      name: 'ACME 38',
    })
  })
})

describe('acteur', () => {
  it('nomme l utilisateur', async () => {
    expect(await actorOf(userId)).toEqual({ actorId: userId, actorLabel: 'Keveen' })
  })

  it('nomme le système pour une chaîne vide', async () => {
    expect(await actorOf('')).toEqual({ actorId: '', actorLabel: 'SYSTEME' })
  })

  it('retombe sur l identifiant quand le compte a disparu', async () => {
    // Le journal survit à la suppression d'un compte : son acteur doit
    // rester nommable, même approximativement.
    expect(await actorOf('usr_inconnu')).toEqual({
      actorId: 'usr_inconnu',
      actorLabel: 'usr_inconnu',
    })
  })
})

describe('rattrapage par since', () => {
  beforeEach(async () => {
    await ajout({ action: 'saisie.creee', entityType: 'TimeEntry', entityId: 't1' })
    await ajout({ action: 'cra.valide', entityId: 'cra_1' })
    await ajout({ action: 'saisie.creee', entityType: 'TimeEntry', entityId: 't2' })
  })

  it('rend tout depuis l origine', async () => {
    const tout = await readAuditSince({ since: 0 })
    expect(tout.map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('reprend strictement après le seq fourni', async () => {
    expect((await readAuditSince({ since: 2 })).map((e) => e.seq)).toEqual([3])
    expect(await readAuditSince({ since: 3 })).toEqual([])
  })

  it('ne perd ni ne répète aucun événement quand un consommateur boucle', async () => {
    // La promesse centrale du modèle : un consommateur mémorise son dernier
    // seq et reprend où il s'était arrêté.
    const vus: number[] = []
    let curseur = 0
    for (;;) {
      const lot = await readAuditSince({ since: curseur, limit: 2 })
      if (lot.length === 0) break
      vus.push(...lot.map((e) => e.seq))
      curseur = lot[lot.length - 1]!.seq
    }
    expect(vus).toEqual([1, 2, 3])
    expect(new Set(vus).size).toBe(vus.length)
  })

  it('filtre par événement sans casser la reprise', async () => {
    const saisies = await readAuditSince({ since: 0, action: 'saisie.creee' })
    expect(saisies.map((e) => e.seq)).toEqual([1, 3])
    expect(await readAuditSince({ since: 1, action: 'saisie.creee' })).toHaveLength(1)
  })

  it('borne le lot rendu', async () => {
    expect(await readAuditSince({ since: 0, limit: 2 })).toHaveLength(2)
  })

  it('n est volontairement PAS scopée par utilisateur', async () => {
    // Elle sert un jeton d'instance, pas une session, dans un produit
    // mono-organisation. Ce test existe pour qu'on ne « corrige » pas cette
    // décision par mégarde.
    await ajout({ actorId: autreId, actorLabel: 'Autre', entityId: 'cra_autre' })
    expect((await readAuditSince({ since: 0 })).some((e) => e.actorId === autreId)).toBe(true)
  })
})

describe('lecture de supervision', () => {
  beforeEach(async () => {
    await ajout({ action: 'saisie.creee', entityType: 'TimeEntry', entityId: 't1' })
    await ajout({ actorId: autreId, actorLabel: 'Autre', entityId: 'cra_autre' })
    await appendAudit({
      action: 'travail.echoue',
      entityType: 'ScheduledJob',
      entityId: 'journal.verification',
      ...ACTEUR_SYSTEME,
      payload: {},
    })
  })

  it('isole par utilisateur, système inclus', async () => {
    const vues = await listAuditEvents(userId)
    const acteurs = new Set(vues.map((e) => e.actorId))
    expect(acteurs).toEqual(new Set([userId, '']))
  })

  it('ne rend rien de plus quand on retire le userId de la requête', async () => {
    // Le test d'isolation qui compte : il porte sur ce que la REQUÊTE rend,
    // et non sur un retour anticipé — deux tests de ce genre, sur ce projet,
    // sortaient avant même d'atteindre la base.
    const vues = await listAuditEvents(autreId)
    expect(vues.map((e) => e.actorId).sort()).toEqual(['', autreId])
    expect(vues.some((e) => e.actorId === userId)).toBe(false)
  })

  it('rend les plus récentes d abord', async () => {
    const vues = await listAuditEvents(userId)
    expect(vues[0]!.seq).toBeGreaterThan(vues[vues.length - 1]!.seq)
  })

  it('filtre par action, par entité et par période', async () => {
    expect(await listAuditEvents(userId, { action: 'saisie.creee' })).toHaveLength(1)
    expect(await listAuditEvents(userId, { entityType: 'ScheduledJob' })).toHaveLength(1)
    expect(await listAuditEvents(userId, { du: '2099-01-01' })).toHaveLength(0)
  })

  it('inclut la borne haute du jour demandé', async () => {
    const aujourdhui = new Date().toISOString().slice(0, 10)
    expect((await listAuditEvents(userId, { au: aujourdhui })).length).toBeGreaterThan(0)
  })
})

describe('vérification de la chaîne en base', () => {
  it('valide un journal intact', async () => {
    await ajout()
    await ajout({ entityId: 'cra_2' })
    expect(await verifyJournalChain()).toEqual({ ok: true, verifiees: 2 })
  })

  it('valide un journal vide', async () => {
    expect(await verifyJournalChain()).toEqual({ ok: true, verifiees: 0 })
  })

  it('DÉTECTE UNE MODIFICATION DIRECTE EN BASE, À LA BONNE ENTRÉE', async () => {
    // C'est le test qui fait de ce journal une preuve plutôt qu'un
    // historique. On contourne délibérément le service — c'est exactement ce
    // que ferait quelqu'un qui voudrait réécrire l'histoire.
    for (let i = 1; i <= 5; i++) await ajout({ entityId: `cra_${i}` })

    await prisma.auditEvent.update({
      where: { seq: 3 },
      data: { payloadJson: '{"month":"2026-01"}' },
    })

    expect(await verifyJournalChain()).toEqual({
      ok: false,
      verifiees: 2,
      seq: 3,
      raison: 'EMPREINTE',
    })
  })

  it('détecte une entrée supprimée en base', async () => {
    for (let i = 1; i <= 5; i++) await ajout({ entityId: `cra_${i}` })
    await prisma.auditEvent.delete({ where: { seq: 3 } })

    expect(await verifyJournalChain()).toMatchObject({ ok: false, seq: 4, raison: 'CHAINAGE' })
  })

  it('détecte un seq renuméroté en base', async () => {
    // Renuméroter est la falsification la plus discrète : rien ne change de
    // contenu. Le numéro d'ordre entrant dans l'empreinte, elle se voit.
    for (let i = 1; i <= 3; i++) await ajout({ entityId: `cra_${i}` })
    await prisma.auditEvent.update({ where: { seq: 3 }, data: { seq: 9 } })

    expect(await verifyJournalChain()).toMatchObject({ ok: false, seq: 9, raison: 'EMPREINTE' })
  })
})

describe('numéro d ordre courant', () => {
  it('vaut zéro sur un journal vide', async () => {
    expect(await currentAuditSeq()).toBe(0)
  })

  it('suit la dernière entrée', async () => {
    await ajout()
    await ajout({ entityId: 'cra_2' })
    expect(await currentAuditSeq()).toBe(2)
  })
})
