import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/db/client'
import { ENTITY_CRA } from '@/core/sync/policy'
import { createClient } from './clients'
import { createMission, createLine } from './missions'
import { getOrCreateCra, transitionCra, listCrasSuivi, updateInvoiceTracking, getCra } from './cra'
import { InvalidTransitionError } from '@/core/cra/state-machine'
import { ETATS_SUIVI } from '@/core/cra/etat-suivi'
import type { CraStatus } from '@/core/types'
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

  // Le suivi de facturation engage : « cette prestation est facturée, à ce
  // numéro, payée à cette date ». Sans la lecture scopée qui précède
  // l'écriture, tout compte authentifié pouvait l'inscrire sur le CRA d'un
  // autre consultant — et rien dans la suite ne s'en apercevait.
  it('refuse d inscrire un suivi de facturation sur le CRA d un autre', async () => {
    const cra = await getOrCreateCra(userId, missionId, '2026-03')
    const autre = await prisma.user.create({
      data: { email: 'facture-autre@test.local', name: 'A', passwordHash: 'x' },
    })

    await expect(
      updateInvoiceTracking(autre.id, cra.id, {
        invoiceNumber: 'FA-INTRUS',
        invoicedAt: new Date('2026-04-02T00:00:00Z'),
        paidAt: new Date('2026-04-30T00:00:00Z'),
      }),
    ).rejects.toThrow()

    const relu = await prisma.cra.findUniqueOrThrow({ where: { id: cra.id } })
    expect(relu.invoiceNumber).toBeNull()
    expect(relu.invoicedAt).toBeNull()
    expect(relu.paidAt).toBeNull()
    // Rien n'a eu lieu, donc rien n'est consigné : un journal qui atteste d'un
    // acte refusé raconte une facturation qui n'existe pas.
    const entrees = (await readAuditSince({ since: 0 })).filter(
      (e) => e.entityId === cra.id && e.action === 'facturation.renseignee',
    )
    expect(entrees).toHaveLength(0)

    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('liste les CRA d un mois', async () => {
    await getOrCreateCra(userId, missionId, '2026-03')
    const list = await listCrasSuivi(userId, { etats: [...ETATS_SUIVI], month: '2026-03' })
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

    await listCrasSuivi(userId, { etats: [...ETATS_SUIVI], month: '2027-03' })

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

    const relu = (
      await listCrasSuivi(userId, { etats: [...ETATS_SUIVI], month: '2026-08' })
    ).find((c) => c.id === cra.id)!
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

    const relu = (
      await listCrasSuivi(userId, { etats: [...ETATS_SUIVI], month: '2026-10' })
    ).find((c) => c.id === cra.id)!
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

describe('getCra', () => {
  // Identifiants figés en dur : `getCra` sert une page de détail adressée par
  // id (`/cra/[craId]`), pas par mois — le montage doit donc fixer les siens
  // plutôt que de reprendre `userId`/`missionId` du module, communs au reste
  // du fichier.
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: 'u1', email: 'getcra@test.local', name: 'U1', passwordHash: 'x' },
    })
    await prisma.user.create({
      data: { id: 'u2', email: 'getcra-autre@test.local', name: 'U2', passwordHash: 'x' },
    })
    const client = await createClient('GETCRA client')
    const mission = await createMission({ clientId: client.id, label: 'GETCRA mission' })
    const ligne = await createLine({
      missionId: mission.id,
      userId: 'u1',
      label: 'Consultant',
      soldCentiemes: 3000,
      tjmCents: 0,
    })

    await prisma.cra.create({
      data: {
        id: 'cra-1',
        missionId: mission.id,
        userId: 'u1',
        month: new Date('2026-05-01T00:00:00.000Z'),
        status: 'BROUILLON',
      },
    })
    await prisma.timeEntry.create({
      data: {
        lineId: ligne.id,
        userId: 'u1',
        date: new Date('2026-05-04T00:00:00.000Z'),
        minutes: 420,
        minutesParJour: 420,
        kind: 'REALISE',
        slotId: 'REALISE-1',
        startMinute: 540,
      },
    })

    await prisma.cra.create({
      data: {
        id: 'cra-valide',
        missionId: mission.id,
        userId: 'u1',
        month: new Date('2026-06-01T00:00:00.000Z'),
        status: 'VALIDE',
      },
    })
    // Du prévisionnel bien réel sur ce mois : sans lui, le test suivant
    // passerait même si `getCra` oubliait de forcer le zéro, puisque le
    // compte brut serait déjà nul.
    await prisma.timeEntry.create({
      data: {
        lineId: ligne.id,
        userId: 'u1',
        date: new Date('2026-06-10T00:00:00.000Z'),
        minutes: 420,
        minutesParJour: 420,
        kind: 'PREVISIONNEL',
        slotId: 'PREVISIONNEL-1',
        startMinute: 600,
      },
    })
  })

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { userId: 'u1' } })
    await prisma.cra.deleteMany({ where: { id: { in: ['cra-1', 'cra-valide'] } } })
    await prisma.client.deleteMany({ where: { name: 'GETCRA client' } })
    await prisma.user.deleteMany({ where: { id: { in: ['u1', 'u2'] } } })
  })

  it('rend un CRA complet — synthese, previsionnel et armement Dolibarr', async () => {
    const cra = await getCra('u1', 'cra-1')

    expect(cra.id).toBe('cra-1')
    expect(cra.synthese.totalCentiemes).toBeGreaterThan(0)
  })

  // Le scope par utilisateur est la garantie qu'on n'affiche jamais le CRA
  // d'un autre. Il se teste, il ne se suppose pas.
  it('leve quand le CRA appartient a quelqu un d autre', async () => {
    await expect(getCra('u2', 'cra-1')).rejects.toThrow()
  })

  // Un CRA valide n'a plus de previsionnel a annoncer : il a ete emporte au
  // moment ou il l'a ete. La liste applique deja cette regle ; le detail ne
  // peut pas en appliquer une autre.
  it('n annonce aucun previsionnel sur un CRA valide', async () => {
    const cra = await getCra('u1', 'cra-valide')

    expect(cra.previsionnelAAnnuler).toBe(0)
  })
})

describe('listCrasSuivi', () => {
  // Deux missions aux libelles ordonnes, pour le tri « mois, puis mission » —
  // et un second utilisateur, pour verifier que rien ne fuit d'un compte a
  // l'autre. Identifiants figes en dur, comme dans `describe('getCra', ...)`,
  // parce que les tests ci-dessous adressent des CRA precis par etat et par
  // mois plutot que par le premier de la liste.
  let clientSuiviId = ''
  let missionAlphaId = ''
  let missionZuluId = ''

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: 'suivi-u1', email: 'suivi@test.local', name: 'Suivi', passwordHash: 'x' },
    })
    await prisma.user.create({
      data: { id: 'suivi-u2', email: 'suivi-autre@test.local', name: 'Autre', passwordHash: 'x' },
    })
    const client = await createClient('SUIVI client')
    clientSuiviId = client.id
    const alpha = await createMission({ clientId: client.id, label: 'Alpha mission' })
    const zulu = await createMission({ clientId: client.id, label: 'Zulu mission' })
    missionAlphaId = alpha.id
    missionZuluId = zulu.id
  })

  afterAll(async () => {
    await prisma.cra.deleteMany({ where: { userId: { in: ['suivi-u1', 'suivi-u2'] } } })
    await prisma.mission.deleteMany({ where: { clientId: clientSuiviId } })
    await prisma.client.deleteMany({ where: { name: 'SUIVI client' } })
    await prisma.user.deleteMany({ where: { id: { in: ['suivi-u1', 'suivi-u2'] } } })
  })

  beforeEach(async () => {
    // Chaque test seme ses propres CRA : sans ce nettoyage, ceux d'un test
    // fuiraient dans le suivant a travers le meme couple utilisateur/mission.
    await prisma.cra.deleteMany({ where: { userId: { in: ['suivi-u1', 'suivi-u2'] } } })
  })

  /**
   * Un CRA seme directement en base, sans passer par la machine a etats.
   *
   * Une mission propre a chaque CRA par defaut : la contrainte d'unicite porte
   * sur (missionId, userId, month), et plusieurs CRA d'un meme test partagent
   * souvent le meme mois — les faire tous porter sur `missionAlphaId`
   * entrerait en collision les uns avec les autres.
   */
  async function semerCra(args: {
    id: string
    userId?: string
    missionId?: string
    month: string
    status: CraStatus
    invoiceNumber?: string | null
    invoicedAt?: Date | null
  }): Promise<void> {
    const missionId =
      args.missionId ??
      (await createMission({ clientId: clientSuiviId, label: `Mission ${args.id}` })).id

    await prisma.cra.create({
      data: {
        id: args.id,
        userId: args.userId ?? 'suivi-u1',
        missionId,
        month: new Date(`${args.month}-01T00:00:00.000Z`),
        status: args.status,
        invoiceNumber: args.invoiceNumber ?? null,
        invoicedAt: args.invoicedAt ?? null,
      },
    })
  }

  // LE piege de cet ecran. Sans exclusion explicite, decocher « Facture » ne
  // masquerait rien tant que « Valide » reste coche : les factures sont des
  // CRA valides.
  it('cocher VALIDE sans FACTURE ne ramene pas les factures', async () => {
    await semerCra({ id: 'valide-non-facture', month: '2026-03', status: 'VALIDE' })
    await semerCra({
      id: 'valide-facture',
      month: '2026-03',
      status: 'VALIDE',
      invoiceNumber: 'FA2603-0001',
    })

    const cras = await listCrasSuivi('suivi-u1', { etats: ['VALIDE'] })

    expect(cras.map((c) => c.id)).toEqual(['valide-non-facture'])
  })

  it('cocher FACTURE ne ramene que des valides factures', async () => {
    await semerCra({ id: 'brouillon', month: '2026-03', status: 'BROUILLON' })
    await semerCra({ id: 'valide-non-facture', month: '2026-03', status: 'VALIDE' })
    await semerCra({
      id: 'valide-facture',
      month: '2026-03',
      status: 'VALIDE',
      invoiceNumber: 'FA2603-0002',
    })

    const cras = await listCrasSuivi('suivi-u1', { etats: ['FACTURE'] })

    expect(cras.map((c) => c.id)).toEqual(['valide-facture'])
  })

  // Le miroir exact d'`estFacture` : un numero seul suffit, une date seule
  // suffit aussi. Les deux champs doivent compter independamment.
  it('compte facture un CRA qui ne porte que le numero, ou que la date', async () => {
    await semerCra({
      id: 'facture-par-numero',
      month: '2026-03',
      status: 'VALIDE',
      invoiceNumber: 'FA2603-0003',
    })
    await semerCra({
      id: 'facture-par-date',
      month: '2026-03',
      status: 'VALIDE',
      invoicedAt: new Date('2026-04-02T00:00:00.000Z'),
    })

    const cras = await listCrasSuivi('suivi-u1', { etats: ['FACTURE'] })

    expect(cras.map((c) => c.id).sort()).toEqual(['facture-par-date', 'facture-par-numero'])
  })

  it('groupe les statuts simples en une seule liste', async () => {
    await semerCra({ id: 'brouillon', month: '2026-03', status: 'BROUILLON' })
    await semerCra({ id: 'envoye', month: '2026-03', status: 'ENVOYE' })
    await semerCra({ id: 'refuse', month: '2026-03', status: 'REFUSE' })
    await semerCra({ id: 'valide', month: '2026-03', status: 'VALIDE' })

    const cras = await listCrasSuivi('suivi-u1', { etats: ['BROUILLON', 'ENVOYE', 'REFUSE'] })

    expect(cras.map((c) => c.id).sort()).toEqual(['brouillon', 'envoye', 'refuse'])
  })

  // Aucun etat coche : la reponse est « rien », et elle ne coute aucune
  // requete. Une clause `OR: []` en Prisma ne rend rien non plus, mais elle
  // fait payer le trajet.
  it('ne lit pas la base quand aucun etat n est demande', async () => {
    await semerCra({ id: 'brouillon', month: '2026-03', status: 'BROUILLON' })
    const espion = vi.spyOn(prisma.cra, 'findMany')

    const cras = await listCrasSuivi('suivi-u1', { etats: [] })

    expect(cras).toEqual([])
    expect(espion).not.toHaveBeenCalled()
    espion.mockRestore()
  })

  // Sans mois, toutes periodes : c'est ce qui donne son sens au filtre.
  it('ne borne pas le mois quand aucun n est demande', async () => {
    await semerCra({ id: 'mars', month: '2026-03', status: 'ENVOYE' })
    await semerCra({ id: 'avril', month: '2026-04', status: 'ENVOYE' })

    const cras = await listCrasSuivi('suivi-u1', { etats: ['ENVOYE'] })

    expect(cras.map((c) => c.id).sort()).toEqual(['avril', 'mars'])
  })

  it('borne le mois quand il est demande', async () => {
    await semerCra({ id: 'mars', month: '2026-03', status: 'ENVOYE' })
    await semerCra({ id: 'avril', month: '2026-04', status: 'ENVOYE' })

    const cras = await listCrasSuivi('suivi-u1', { etats: ['ENVOYE'], month: '2026-03' })

    expect(cras.map((c) => c.id)).toEqual(['mars'])
  })

  // Le mois le plus recent en tete : c'est celui sur lequel on agit. A
  // l'interieur d'un meme mois, la mission departage — dans l'ordre de son
  // libelle.
  it('trie du mois le plus recent au plus ancien, puis par mission', async () => {
    await semerCra({
      id: 'mars-zulu',
      month: '2026-03',
      status: 'ENVOYE',
      missionId: missionZuluId,
    })
    await semerCra({
      id: 'mars-alpha',
      month: '2026-03',
      status: 'ENVOYE',
      missionId: missionAlphaId,
    })
    await semerCra({
      id: 'avril-alpha',
      month: '2026-04',
      status: 'ENVOYE',
      missionId: missionAlphaId,
    })

    const cras = await listCrasSuivi('suivi-u1', { etats: ['ENVOYE'] })

    expect(cras.map((c) => c.id)).toEqual(['avril-alpha', 'mars-alpha', 'mars-zulu'])
  })

  it('est toujours scope sur l utilisateur', async () => {
    await semerCra({ id: 'a-moi', month: '2026-03', status: 'ENVOYE', userId: 'suivi-u1' })
    await semerCra({
      id: 'a-un-autre',
      month: '2026-03',
      status: 'ENVOYE',
      userId: 'suivi-u2',
      missionId: missionZuluId,
    })

    const cras = await listCrasSuivi('suivi-u1', { etats: ['ENVOYE'] })

    expect(cras.map((c) => c.id)).toEqual(['a-moi'])
  })
})
