import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import { buildCraPdf } from '@/services/cra-pdf'
import { createFakeSignatureConnector } from './fake-connector'
import { ENTITY_CRA } from './constants'
import { sendCraForSignature } from './send'
import type { Mailer } from '@/services/notify'
import { empreinteJeton } from '@/core/auth/reinitialisation'

const ORIGINE = 'https://cra.test'
let courriels: Array<{ to: string; sujet: string; corps: string }> = []
const mailer: Mailer = async (m) => {
  courriels.push({ to: m.to, sujet: m.sujet, corps: m.corps })
}

let userId = ''
let autreUserId = ''
let missionId = ''
let lineId = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'send@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'send-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreUserId = a.id

  const c = await createClient('SEND client')
  const m = await createMission({
    clientId: c.id,
    label: 'Consultant ITSM',
    signataireNom: 'Claire Martin',
    signataireEmail: 'claire@send.test',
  })
  missionId = m.id
  lineId = (await createLine({ missionId, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000 })).id
})

beforeEach(async () => {
  courriels = []
  await prisma.lienClient.deleteMany({})
  await prisma.signatureEnvoiClos.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
  await prisma.mission.update({
    where: { id: missionId },
    data: { signataireNom: 'Claire Martin', signataireEmail: 'claire@send.test' },
  })
  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
  await saveEntry({ userId, lineId, date: '2026-06-01', minutes: 480, kind: 'REALISE' })
})

afterAll(async () => {
  await prisma.lienClient.deleteMany({})
  await prisma.signatureEnvoiClos.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({
    where: { email: { in: ['send@test.local', 'send-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'SEND client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('sendCraForSignature', () => {
  it('confie le PDF au connecteur et fait passer le CRA à ENVOYE', async () => {
    const connector = createFakeSignatureConnector()
    const r = await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })

    expect(r).toEqual({ ok: true, externalId: 'ext-1', status: 'ENVOYE', numero: 1, courrielEnvoye: true })
    expect(connector.envois).toHaveLength(1)
    expect(connector.envois[0]!.destinataire).toEqual({
      nom: 'Claire Martin',
      email: 'claire@send.test',
    })
    expect(Buffer.from(connector.envois[0]!.pdf).toString('latin1').startsWith('%PDF-')).toBe(true)
    expect(connector.envois[0]!.titre).toContain('juin 2026')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('CONFIE EXACTEMENT LE DOCUMENT DE `buildCraPdf`, jamais une variante', async () => {
    // Le document sans montant est garanti par `cra-pdf.test.ts`, sur les
    // octets. Ce qui doit être vérifié **ici**, c est qu aucun autre document
    // ne part chez le client : contourner `buildCraPdf` rouvrirait la porte
    // aux montants sans qu aucun test du PDF ne bouge.
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })

    const attendu = await buildCraPdf(userId, craId)
    expect(connector.envois[0]!.fileName).toBe(attendu.fileName)
    expect(Buffer.from(connector.envois[0]!.pdf).equals(Buffer.from(attendu.bytes))).toBe(true)
  })

  it('enregistre la référence externe dans ExternalLink', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })

    const lien = await prisma.externalLink.findUniqueOrThrow({
      where: {
        entityType_entityId_provider: {
          entityType: ENTITY_CRA,
          entityId: craId,
          provider: 'double',
        },
      },
    })
    expect(lien.externalId).toBe('ext-1')
    expect(lien.syncState).toBe('EN_ATTENTE')
    // `ExternalLink.userId` est obligatoire (clé étrangère et cascade posées au
    // lot 1b) : le lien appartient à son propriétaire, et disparaît avec lui.
    expect(lien.userId).toBe(userId)
  })

  it('ouvre une demande de signature en attente, sans relance', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.status).toBe('EN_ATTENTE')
    expect(demande.relances).toBe(0)
    expect(demande.abandoned).toBe(false)
    expect(demande.signedPdf).toBeNull()
    // Le destinataire est figé : changer le signataire de la mission ensuite
    // ne réécrit pas à qui le document a été adressé.
    expect(demande.signataireEmail).toBe('claire@send.test')
  })

  it('SANS CONNECTEUR, ne touche à rien et le dit', async () => {
    const r = await sendCraForSignature(userId, craId, { connector: null, origine: ORIGINE, mailer })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_CONNECTEUR')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
    expect(await prisma.signatureRequest.findUnique({ where: { craId } })).toBeNull()
  })

  it('la transition manuelle reste possible sans connecteur', async () => {
    await sendCraForSignature(userId, craId, { connector: null, origine: ORIGINE, mailer })
    const apres = await transitionCra(userId, craId, 'ENVOYER')
    expect(apres.status).toBe('ENVOYE')
  })

  it('refuse d envoyer sans signataire renseigné', async () => {
    await prisma.mission.update({
      where: { id: missionId },
      data: { signataireNom: '', signataireEmail: '' },
    })
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE, mailer })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_SIGNATAIRE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
  })

  it('refuse aussi une adresse sans nom : un destinataire à moitié renseigné n est pas un destinataire', async () => {
    await prisma.mission.update({
      where: { id: missionId },
      data: { signataireNom: '', signataireEmail: 'claire@send.test' },
    })
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE, mailer })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_SIGNATAIRE')
  })

  it('NE TRANSITIONNE PAS quand le connecteur échoue', async () => {
    // Un CRA marqué envoyé que personne n a reçu est pire que pas d envoi du tout.
    const connector = createFakeSignatureConnector()
    connector.faireEchouerEnvoi('Le prestataire est injoignable.')

    const r = await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('CONNECTEUR_EN_ECHEC')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
    expect(await prisma.signatureRequest.findUnique({ where: { craId } })).toBeNull()
    expect(
      await prisma.externalLink.findFirst({ where: { entityType: ENTITY_CRA, entityId: craId } }),
    ).toBeNull()
  })

  it('refuse d envoyer un CRA déjà validé', async () => {
    await prisma.cra.update({ where: { id: craId }, data: { status: 'VALIDE' } })
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE, mailer })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('TRANSITION_IMPOSSIBLE')
  })

  it('refuse d envoyer un CRA déjà envoyé', async () => {
    await prisma.cra.update({ where: { id: craId }, data: { status: 'ENVOYE' } })
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE, mailer })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('TRANSITION_IMPOSSIBLE')
  })

  it('remplace la demande précédente après un refus, et remet les relances à zéro', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    await prisma.signatureRequest.update({
      where: { craId },
      data: { status: 'REFUSE', relances: 3, abandoned: true, completedAt: new Date() },
    })
    await prisma.cra.update({ where: { id: craId }, data: { status: 'REFUSE' } })

    const r = await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect(r.ok).toBe(true)

    const demandes = await prisma.signatureRequest.findMany({ where: { craId } })
    expect(demandes).toHaveLength(1)
    expect(demandes[0]!.status).toBe('EN_ATTENTE')
    expect(demandes[0]!.relances).toBe(0)
    expect(demandes[0]!.abandoned).toBe(false)
    expect(demandes[0]!.completedAt).toBeNull()

    const lien = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: ENTITY_CRA, entityId: craId },
    })
    expect(lien.externalId).toBe('ext-2')
  })

  it('efface le PDF archivé quand on renvoie — l archive suit le document en cours', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    await prisma.signatureRequest.update({
      where: { craId },
      data: { signedPdf: Buffer.from('ancien'), status: 'REFUSE' },
    })
    await prisma.cra.update({ where: { id: craId }, data: { status: 'REFUSE' } })

    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.signedPdf).toBeNull()
  })

  it('CONSIGNE LA TRANSITION AU JOURNAL, comme le bouton « Marquer envoyé »', async () => {
    // L'envoi pour signature est le geste central du lot : il franchissait
    // `BROUILLON → ENVOYE` par un `cra.update` direct, donc sans passer par
    // `transitionCra` — le seul point qui consigne. Le même changement d'état
    // était journalisé au clic manuel et muet ici, et l'historique d'un CRA
    // validé montrait `cra.ouvert` puis `cra.valide` avec un trou au milieu.
    await prisma.auditEvent.deleteMany({})
    const connector = createFakeSignatureConnector()

    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })

    const entrees = await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } })
    const envoye = entrees.find((e) => e.action === 'cra.envoye')
    expect(envoye, 'aucune entrée `cra.envoye`').toBeDefined()
    expect(envoye!.entityId).toBe(craId)
    expect(envoye!.actorId).toBe(userId)
  })

  it('CONSIGNE `signature.envoyee`, que le catalogue promet aux abonnés', async () => {
    await prisma.auditEvent.deleteMany({})
    const connector = createFakeSignatureConnector()

    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })

    const entrees = await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } })
    const signature = entrees.find((e) => e.action === 'signature.envoyee')
    expect(signature, 'aucune entrée `signature.envoyee`').toBeDefined()
    expect(signature!.entityId).toBe(craId)
    const payload = JSON.parse(signature!.payloadJson) as Record<string, unknown>
    expect(payload.provider).toBe('double')
    // Le journal part vers des URL tierces : jamais l'adresse du signataire.
    expect(signature!.payloadJson).not.toContain('claire@send.test')
  })

  it('NE CONSIGNE RIEN quand le connecteur échoue', async () => {
    await prisma.auditEvent.deleteMany({})
    const connector = createFakeSignatureConnector()
    connector.faireEchouerEnvoi('Le prestataire est injoignable.')

    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })

    const actions = (await prisma.auditEvent.findMany({})).map((e) => e.action)
    expect(actions).not.toContain('cra.envoye')
    expect(actions).not.toContain('signature.envoyee')
  })

  it('refuse le CRA d un autre utilisateur', async () => {
    const r = await sendCraForSignature(autreUserId, craId, {
      connector: createFakeSignatureConnector(),
      origine: ORIGINE,
      mailer,
    })
    expect(r.ok).toBe(false)

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
  })
})

describe('lot 3b — envoi par l outil', () => {
  it('fige le contenu, avec son empreinte, sur l envoi', async () => {
    await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE, mailer })
    const d = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    const doc = JSON.parse(d.contenuFige)
    expect(doc.mois).toBe('2026-06')
    expect(doc.totalCentiemes).toBe(100)
    expect(d.empreinte).toMatch(/^[0-9a-f]{64}$/)
    expect(d.externalId).toBe('ext-1')
    expect(d.origine).toBe(ORIGINE)
  })

  it('confie notre référence au prestataire', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect(connector.envois[0]!.reference).toBe(craId)
  })

  it('écrit au signataire, avec un lien dont la base ne garde que l empreinte', async () => {
    await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE, mailer })
    expect(courriels).toHaveLength(1)
    expect(courriels[0]!.to).toBe('claire@send.test')
    const lien = /https:\/\/cra\.test\/v\/([0-9a-f]{64})/.exec(courriels[0]!.corps)
    expect(lien).not.toBeNull()
    const enBase = await prisma.lienClient.findFirstOrThrow({ where: { craId } })
    expect(enBase.jetonEmpreinte).toBe(empreinteJeton(lien![1]!))
    expect(enBase.jetonSignataire).toBe('jeton-1')
    expect(JSON.stringify(enBase)).not.toContain(lien![1]!)
  })

  it('SANS SMTP, envoie quand même et le dit', async () => {
    await prisma.settings.deleteMany({})
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE })
    expect(r).toMatchObject({ ok: true, status: 'ENVOYE', courrielEnvoye: false })
    const journal = await prisma.auditEvent.findMany({ where: { entityId: craId }, orderBy: { seq: 'asc' } })
    expect(journal.map((e) => e.action)).toContain('signature.courriel.echoue')
  })

  it('refuse sans origine publique, sans rien toucher', async () => {
    const connector = createFakeSignatureConnector()
    const r = await sendCraForSignature(userId, craId, { connector, origine: '', mailer })
    expect(r).toMatchObject({ ok: false, raison: 'PAS_D_ORIGINE' })
    expect(connector.envois).toHaveLength(0)
  })

  it('RENVOIE DIRECTEMENT DEPUIS REFUSE : clôt le premier envoi, numérote le second, révoque l ancien lien', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    await prisma.signatureRequest.update({ where: { craId }, data: { status: 'REFUSE', motifRefus: 'Il manque le 15.' } })
    await transitionCra(userId, craId, 'REFUSER')

    const r = await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect(r).toMatchObject({ ok: true, status: 'ENVOYE', numero: 2, externalId: 'ext-2' })

    const clos = await prisma.signatureEnvoiClos.findMany({ where: { craId } })
    expect(clos).toMatchObject([{ numero: 1, status: 'REFUSE', motifRefus: 'Il manque le 15.' }])
    const d = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(d).toMatchObject({ numero: 2, status: 'EN_ATTENTE', motifRefus: '', relances: 0 })

    const liens = await prisma.lienClient.findMany({ where: { craId } })
    expect(liens.find((l) => l.numero === 1)!.revokedAt).not.toBeNull()
    expect(liens.find((l) => l.numero === 2)!.revokedAt).toBeNull()
  })

  it('consigne `signature.renvoyee` sur un renvoi, jamais sur un premier envoi', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    let actions = (await prisma.auditEvent.findMany({ where: { entityId: craId } })).map((e) => e.action)
    expect(actions).not.toContain('signature.renvoyee')

    await transitionCra(userId, craId, 'REFUSER')
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    actions = (await prisma.auditEvent.findMany({ where: { entityId: craId } })).map((e) => e.action)
    expect(actions).toContain('signature.renvoyee')
  })

  it("le journal ne contient ni le signataire, ni le jeton", async () => {
    await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector(), origine: ORIGINE, mailer })
    const tout = (await prisma.auditEvent.findMany({ where: { entityId: craId } })).map((e) => e.payloadJson).join('\n')
    expect(tout).not.toContain('claire')
    expect(tout).not.toContain('Claire')
    expect(tout).not.toContain('jeton-1')
  })
})
