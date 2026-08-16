import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/db/client'
import { ENTITY_CRA } from '@/core/sync/policy'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { getOrCreateCra, transitionCra, listCras, updateInvoiceTracking } from './cra'
import { InvalidTransitionError } from '@/core/cra/state-machine'
import { saveInstanceCredential, revokeInstanceCredential } from './credentials'
import { DOLIBARR } from './dolibarr/api'
import { readAuditSince } from './audit'

// Un interrupteur pour rendre la file indisponible à la demande — même montage
// que `cells.test.ts`, pour la même raison. Sans lui, « la mise en file est
// transactionnelle avec la transition » n'est vérifié nulle part : la suite
// resterait entièrement verte si l'inscription était déplacée *après* la
// transaction, ou si la transaction disparaissait. C'est précisément l'angle
// mort relevé sur les tâches précédentes — une transactionnalité vérifiée sur
// la fonction appelée, jamais sur l'appelant.
const file = vi.hoisted(() => ({ indisponible: false }))

vi.mock('@/services/sync/outbox', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./sync/outbox')>()
  return {
    ...reel,
    enqueueSync: async (...args: Parameters<typeof reel.enqueueSync>) => {
      if (file.indisponible) throw new Error('file indisponible')
      await reel.enqueueSync(...args)
    },
  }
})

let userId = ''
let missionId = ''

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  const u = await prisma.user.create({
    data: { email: 'cra@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('CRA client')
  const m = await createMission({ clientId: c.id, label: 'ITSM' })
  missionId = m.id
  await createLine({ missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 0 })
})

beforeEach(async () => {
  file.indisponible = false
  vi.unstubAllGlobals()
  // La file n'a aucune clé étrangère sur `entityId` : elle survit au CRA
  // qu'elle vise, et doit donc être purgée avant lui.
  await prisma.syncOutbox.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await revokeInstanceCredential(DOLIBARR)
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.user.deleteMany({ where: { email: 'cra@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'CRA client' } })
  await prisma.$disconnect()
})

describe('CRA', () => {
  it('crée un CRA en brouillon', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    expect(cra.status).toBe('BROUILLON')
    expect(cra.month).toBe('2026-03')
    expect(cra.missionLabel).toBe('ITSM')
  })

  it('est idempotent sur le même mois', async () => {
    const a = await getOrCreateCra(userId, missionId, '2026-03')
    const b = await getOrCreateCra(userId, missionId, '2026-03')
    expect(a.id).toBe(b.id)
  })

  it('suit le parcours manuel jusqu à VALIDE', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    const envoye = await transitionCra(userId, cra.id, 'ENVOYER')
    expect(envoye.status).toBe('ENVOYE')
    const valide = await transitionCra(userId, cra.id, 'VALIDER')
    expect(valide.status).toBe('VALIDE')
  })

  it('refuse une transition interdite', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await expect(transitionCra(userId, cra.id, 'VALIDER')).rejects.toThrow(InvalidTransitionError)
  })

  it('permet de rouvrir un CRA validé', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')
    const rouvert = await transitionCra(userId, cra.id, 'ROUVRIR')
    expect(rouvert.status).toBe('BROUILLON')
  })

  it('refuse d agir sur le CRA d un autre utilisateur', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    const autre = await prisma.user.create({
      data: { email: 'autre-cra@test.local', name: 'A', passwordHash: 'x' },
    })
    await expect(transitionCra(autre.id, cra.id, 'ENVOYER')).rejects.toThrow()
    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('enregistre le suivi de facturation sans rien calculer', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    const r = await updateInvoiceTracking(userId, cra.id, {
      invoiceNumber: 'FA2603-0012',
      invoicedAt: new Date('2026-04-02T00:00:00Z'),
    })
    expect(r.invoiceNumber).toBe('FA2603-0012')
    expect(r.invoicedAt?.toISOString()).toBe('2026-04-02T00:00:00.000Z')
    expect(r.paidAt).toBeNull()
  })

  it('liste les CRA d un mois', async () => {
    await getOrCreateCra(userId, missionId, '2026-03')
    const list = await listCras(userId, '2026-03')
    expect(list).toHaveLength(1)
    expect(list[0]!.clientName).toBe('CRA client')
  })
})

describe('mise en file à la validation', () => {
  async function connecterDolibarr(): Promise<void> {
    await saveInstanceCredential({
      provider: DOLIBARR,
      secret: 'cle-de-test',
      baseUrl: 'https://dolibarr.invalid/api/index.php',
      metadata: { dolibarrUserId: '7' },
    })
  }

  async function rattacherLaMission(): Promise<void> {
    await prisma.externalLink.create({
      data: {
        // `userId` est obligatoire sur `ExternalLink` depuis la revue du lot
        // 1b (clé étrangère et cascade) : l'omettre ne laisse pas passer un
        // lien muet, il fait échouer l'écriture.
        userId,
        entityType: 'Mission',
        entityId: missionId,
        provider: DOLIBARR,
        externalId: '1',
      },
    })
  }

  /** Dolibarr connecté **et** mission rattachée à un projet : les deux gardes. */
  async function armerDolibarr(): Promise<void> {
    await connecterDolibarr()
    await rattacherLaMission()
  }

  async function valider(month: string): Promise<string> {
    const cra = await getOrCreateCra(userId, missionId, month)
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')
    return cra.id
  }

  it('n inscrit rien quand Dolibarr n est pas connecté, et valide quand même', async () => {
    // La mission **est** rattachée : seule la clé d'API manque. C'est l'état
    // d'une instance déconnectée dont les correspondances sont restées en
    // base, et c'est le seul montage où cette garde-ci est observable — sans
    // le rattachement, l'autre garde suffirait à faire passer le test, et
    // supprimer celle-ci ne casserait rien.
    await rattacherLaMission()
    const craId = await valider('2026-03')

    // L'application est autoportante : sans Dolibarr, la validation est
    // exactement celle d'avant.
    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  it('n inscrit rien quand la mission n est rattachée à aucun projet', async () => {
    await saveInstanceCredential({
      provider: DOLIBARR,
      secret: 'cle-de-test',
      baseUrl: 'https://dolibarr.invalid/api/index.php',
    })

    const craId = await valider('2026-03')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  it('inscrit le CRA à la validation, sous la clé que le drainage filtre', async () => {
    await armerDolibarr()
    const craId = await valider('2026-03')

    const lignes = await prisma.syncOutbox.findMany()
    expect(lignes).toHaveLength(1)
    // Le fournisseur et le type d'entité sont *la* clé : le drainage
    // générique filtre sur `provider`, et le gestionnaire Dolibarr refuse
    // tout `entityType` qu'il ne connaît pas. Une ligne déposée sous
    // « GOOGLE » serait avalée par le drainage de l'agenda — qui n'y
    // retrouverait aucune saisie, conclurait « plus rien à pousser » et la
    // supprimerait, sans qu'aucun écran ne montre d'échec.
    expect(lignes[0]!.provider).toBe(DOLIBARR)
    expect(lignes[0]!.entityType).toBe(ENTITY_CRA)
    expect(lignes[0]!.entityId).toBe(craId)
    expect(lignes[0]!.userId).toBe(userId)
    expect(lignes[0]!.state).toBe('PENDING')
    expect(lignes[0]!.operation).toBe('UPSERT')
    expect(lignes[0]!.attempts).toBe(0)
  })

  it('n inscrit rien sur une transition qui ne valide pas', async () => {
    await armerDolibarr()
    const cra = await getOrCreateCra(userId, missionId, '2026-03')

    await transitionCra(userId, cra.id, 'ENVOYER')
    expect(await prisma.syncOutbox.count()).toBe(0)

    await transitionCra(userId, cra.id, 'REFUSER')
    expect(await prisma.syncOutbox.count()).toBe(0)

    await transitionCra(userId, cra.id, 'ROUVRIR')
    expect(await prisma.syncOutbox.count()).toBe(0)
  })

  it('rouvrir puis revalider ne produit toujours qu une ligne, et jamais de suppression', async () => {
    await armerDolibarr()
    const craId = await valider('2026-03')

    await transitionCra(userId, craId, 'ROUVRIR')
    // La réouverture ne met rien en file : le connecteur ne sait pas
    // supprimer un CRA, et son gestionnaire refuse tout `DELETE`. Retirer des
    // temps se fait en rouvrant, corrigeant, puis revalidant — c'est la
    // réconciliation du push qui les retire de Dolibarr.
    expect(await prisma.syncOutbox.count({ where: { operation: 'DELETE' } })).toBe(0)

    await transitionCra(userId, craId, 'ENVOYER')
    await transitionCra(userId, craId, 'VALIDER')

    const lignes = await prisma.syncOutbox.findMany()
    expect(lignes).toHaveLength(1)
    expect(lignes[0]!.operation).toBe('UPSERT')
  })

  it('valide sans jamais appeler Dolibarr : une panne ne peut pas la bloquer', async () => {
    await armerDolibarr()
    // Aucun appel réseau n'a le droit d'avoir lieu pendant une validation. Si
    // la mise en file cédait la place à un push direct, ce `fetch` lèverait —
    // et une instance éteinte empêcherait de valider un CRA.
    const reseau = vi.fn(() => {
      throw new Error('aucun appel réseau ne doit partir de la validation')
    })
    vi.stubGlobal('fetch', reseau)

    const cra = await getOrCreateCra(userId, missionId, '2026-04')
    await transitionCra(userId, cra.id, 'ENVOYER')
    const valide = await transitionCra(userId, cra.id, 'VALIDER')

    expect(valide.status).toBe('VALIDE')
    expect(reseau).not.toHaveBeenCalled()
    expect(await prisma.syncOutbox.count()).toBe(1)
  })

  it('ne laisse ni transition ni ligne quand la file est indisponible', async () => {
    await armerDolibarr()
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    await transitionCra(userId, cra.id, 'ENVOYER')

    file.indisponible = true
    await expect(transitionCra(userId, cra.id, 'VALIDER')).rejects.toThrow('file indisponible')

    // Un CRA validé sans ligne de file serait un mois verrouillé que rien ne
    // pousserait jamais : Dolibarr resterait vide, et aucun écran ne le
    // dirait. Les deux écritures vivent ou meurent ensemble.
    const apres = await prisma.cra.findUniqueOrThrow({ where: { id: cra.id } })
    expect(apres.status).toBe('ENVOYE')
    expect(await prisma.syncOutbox.count()).toBe(0)
  })
})

describe('consignation du CRA', () => {
  beforeEach(async () => {
    await prisma.auditEvent.deleteMany({})
  })

  it('consigne l ouverture, une seule fois', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-11')
    await getOrCreateCra(userId, missionId, '2026-11')

    const journal = await readAuditSince({ since: 0 })
    expect(journal.map((e) => e.action)).toEqual(['cra.ouvert'])
    expect(journal[0]).toMatchObject({ entityType: 'Cra', entityId: cra.id, actorId: userId })
    expect(journal[0]!.payload).toMatchObject({ missionId, month: '2026-11' })
  })

  it('consigne chaque transition sous son propre nom', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-12')
    await prisma.auditEvent.deleteMany({})

    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'VALIDER')
    await transitionCra(userId, cra.id, 'ROUVRIR')
    await transitionCra(userId, cra.id, 'ENVOYER')
    await transitionCra(userId, cra.id, 'REFUSER')

    expect((await readAuditSince({ since: 0 })).map((e) => e.action)).toEqual([
      'cra.envoye', 'cra.valide', 'cra.rouvert', 'cra.envoye', 'cra.refuse',
    ])
  })

  it('consigne le statut d avant et d après', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2027-01')
    await prisma.auditEvent.deleteMany({})
    await transitionCra(userId, cra.id, 'ENVOYER')

    expect((await readAuditSince({ since: 0 }))[0]!.payload).toMatchObject({
      statutAvant: 'BROUILLON',
      statutApres: 'ENVOYE',
      month: '2027-01',
    })
  })

  it('ne consigne rien quand la transition est impossible', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2027-02')
    await prisma.auditEvent.deleteMany({})

    await expect(transitionCra(userId, cra.id, 'VALIDER')).rejects.toThrow()
    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })

  it('consigne le suivi de facturation saisi à la main', async () => {
    // La demande de facture à Dolibarr a été retirée du produit : il n'existe
    // plus d'événement `facture.demandee`. Ce qui subsiste — et engage — c'est
    // ce suivi manuel, porté par le CRA.
    const cra = await getOrCreateCra(userId, missionId, '2027-04')
    await prisma.auditEvent.deleteMany({})

    await updateInvoiceTracking(userId, cra.id, {
      invoiceNumber: 'FA2704-0001',
      invoicedAt: new Date('2027-05-02T00:00:00Z'),
    })

    const journal = await readAuditSince({ since: 0 })
    expect(journal.map((e) => e.action)).toEqual(['facturation.renseignee'])
    expect(journal[0]).toMatchObject({ entityType: 'Cra', entityId: cra.id, actorId: userId })
    expect(journal[0]!.payload).toMatchObject({
      cles: ['invoiceNumber', 'invoicedAt'],
      invoiceNumber: 'FA2704-0001',
    })
  })

  it('ne consigne aucune consultation', async () => {
    await getOrCreateCra(userId, missionId, '2027-03')
    await prisma.auditEvent.deleteMany({})

    await listCras(userId, '2027-03')

    expect(await readAuditSince({ since: 0 })).toHaveLength(0)
  })
})

describe('CraView et signature', () => {
  it('rend une signature nulle tant qu aucune demande n existe', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-09')
    expect(cra.signature).toBeNull()
  })

  it('expose le signataire porté par la mission', async () => {
    await prisma.mission.update({
      where: { id: missionId },
      data: { signataireNom: 'Claire Martin', signataireEmail: 'claire@cra.test' },
    })
    const cra = await getOrCreateCra(userId, missionId, '2026-09')
    expect(cra.signataireEmail).toBe('claire@cra.test')
    expect(cra.signataireNom).toBe('Claire Martin')
  })

  it('projette la demande de signature en cours', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-08')
    await prisma.signatureRequest.create({
      data: {
        craId: cra.id,
        provider: 'double',
        status: 'EN_ATTENTE',
        sentAt: new Date('2026-09-02T09:00:00.000Z'),
        relances: 2,
        lastRelanceAt: new Date('2026-09-16T09:00:00.000Z'),
        abandoned: true,
      },
    })

    const relu = (await listCras(userId, '2026-08')).find((c) => c.id === cra.id)!
    expect(relu.signature).toEqual({
      provider: 'double',
      status: 'EN_ATTENTE',
      sentAt: new Date('2026-09-02T09:00:00.000Z'),
      relances: 2,
      lastRelanceAt: new Date('2026-09-16T09:00:00.000Z'),
      abandoned: true,
      archive: false,
    })
  })

  it('ne transporte jamais les octets du PDF archivé, seulement le fait qu il existe', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-10')
    await prisma.signatureRequest.create({
      data: { craId: cra.id, provider: 'double', signedPdf: Buffer.from('%PDF') },
    })

    const relu = (await listCras(userId, '2026-10')).find((c) => c.id === cra.id)!
    expect(relu.signature?.archive).toBe(true)
    expect(JSON.stringify(relu)).not.toContain('signedPdf')
  })

  // Le test ci-dessus ne dit rien de la **requête** : `toView` projette champ
  // par champ, un `signedPdf: true` glissé dans `WITH_MISSION` ne changerait
  // donc aucune valeur rendue — il ferait seulement traverser des centaines de
  // kilo-octets par ligne à chaque affichage de la page CRA, sans qu'aucune
  // assertion de valeur ne s'en aperçoive. La règle porte sur la projection :
  // elle se vérifie sur la projection.
  it('NE SÉLECTIONNE JAMAIS signedPdf dans la projection de lecture', async () => {
    const source = readFileSync(join(process.cwd(), 'src', 'services', 'cra.ts'), 'utf8')
    const bloc = /const WITH_MISSION = \{[\s\S]*?\n\} as const/.exec(source)
    expect(bloc, 'WITH_MISSION introuvable dans src/services/cra.ts').not.toBeNull()
    // Débarrassé de ses commentaires : celui qui *documente* la règle la nomme
    // forcément, il ne l'enfreint pas. Même parti pris que `design-system.test.ts`.
    const code = bloc![0].replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).not.toMatch(/signedPdf/)
  })
})
