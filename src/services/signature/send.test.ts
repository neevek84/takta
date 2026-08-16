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
    const r = await sendCraForSignature(userId, craId, { connector })

    expect(r).toEqual({ ok: true, externalId: 'ext-1', status: 'ENVOYE' })
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
    await sendCraForSignature(userId, craId, { connector })

    const attendu = await buildCraPdf(userId, craId)
    expect(connector.envois[0]!.fileName).toBe(attendu.fileName)
    expect(Buffer.from(connector.envois[0]!.pdf).equals(Buffer.from(attendu.bytes))).toBe(true)
  })

  it('enregistre la référence externe dans ExternalLink', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector })

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
    await sendCraForSignature(userId, craId, { connector })

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
    const r = await sendCraForSignature(userId, craId, { connector: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_CONNECTEUR')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
    expect(await prisma.signatureRequest.findUnique({ where: { craId } })).toBeNull()
  })

  it('la transition manuelle reste possible sans connecteur', async () => {
    await sendCraForSignature(userId, craId, { connector: null })
    const apres = await transitionCra(userId, craId, 'ENVOYER')
    expect(apres.status).toBe('ENVOYE')
  })

  it('refuse d envoyer sans signataire renseigné', async () => {
    await prisma.mission.update({
      where: { id: missionId },
      data: { signataireNom: '', signataireEmail: '' },
    })
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector() })
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
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_SIGNATAIRE')
  })

  it('NE TRANSITIONNE PAS quand le connecteur échoue', async () => {
    // Un CRA marqué envoyé que personne n a reçu est pire que pas d envoi du tout.
    const connector = createFakeSignatureConnector()
    connector.faireEchouerEnvoi('Le prestataire est injoignable.')

    const r = await sendCraForSignature(userId, craId, { connector })
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
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('TRANSITION_IMPOSSIBLE')
  })

  it('refuse d envoyer un CRA déjà envoyé', async () => {
    await prisma.cra.update({ where: { id: craId }, data: { status: 'ENVOYE' } })
    const r = await sendCraForSignature(userId, craId, { connector: createFakeSignatureConnector() })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('TRANSITION_IMPOSSIBLE')
  })

  it('remplace la demande précédente après un refus, et remet les relances à zéro', async () => {
    const connector = createFakeSignatureConnector()
    await sendCraForSignature(userId, craId, { connector })
    await prisma.signatureRequest.update({
      where: { craId },
      data: { status: 'REFUSE', relances: 3, abandoned: true, completedAt: new Date() },
    })
    await prisma.cra.update({ where: { id: craId }, data: { status: 'BROUILLON' } })

    const r = await sendCraForSignature(userId, craId, { connector })
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
    await sendCraForSignature(userId, craId, { connector })
    await prisma.signatureRequest.update({
      where: { craId },
      data: { signedPdf: Buffer.from('ancien'), status: 'REFUSE' },
    })
    await prisma.cra.update({ where: { id: craId }, data: { status: 'BROUILLON' } })

    await sendCraForSignature(userId, craId, { connector })
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.signedPdf).toBeNull()
  })

  it('refuse le CRA d un autre utilisateur', async () => {
    const r = await sendCraForSignature(autreUserId, craId, {
      connector: createFakeSignatureConnector(),
    })
    expect(r.ok).toBe(false)

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('BROUILLON')
  })
})
