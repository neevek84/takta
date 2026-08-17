import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { ENTITY_CRA } from '@/core/sync/policy'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import { saveInstanceCredential, revokeInstanceCredential } from '@/services/credentials'
import { DOLIBARR } from '@/services/dolibarr/api'
import { createFakeSignatureConnector } from './fake-connector'
import { applySignatureStatus } from './apply'

let userId = ''
let missionId = ''
let lineId = ''
let craId = ''

/** Dolibarr « armé » : une clé d'instance et une mission rattachée à un projet. */
async function armerDolibarr(): Promise<void> {
  await saveInstanceCredential({
    provider: DOLIBARR,
    secret: 'cle-de-test',
    baseUrl: 'https://dolibarr.invalid/api/index.php',
    metadata: { dolibarrUserId: '7' },
  })
  await prisma.externalLink.create({
    data: {
      // `userId` est obligatoire sur `ExternalLink` depuis la revue du lot 1b.
      userId,
      entityType: 'Mission',
      entityId: missionId,
      provider: DOLIBARR,
      externalId: '1',
    },
  })
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  const u = await prisma.user.create({
    data: { email: 'apply@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('APPLY client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  lineId = (await createLine({ missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await revokeInstanceCredential(DOLIBARR)
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
  await prisma.cra.update({ where: { id: craId }, data: { status: 'ENVOYE' } })
  await prisma.signatureRequest.create({
    data: { craId, provider: 'double', status: 'EN_ATTENTE' },
  })
})

afterAll(async () => {
  await prisma.syncOutbox.deleteMany({})
  await prisma.signatureRequest.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.user.deleteMany({ where: { email: 'apply@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'APPLY client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('applySignatureStatus', () => {
  it('SIGNE fait passer le CRA à VALIDE et archive le document signé', async () => {
    const connector = createFakeSignatureConnector()
    connector.poserPdfSigne('ext-1', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53]))

    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'SIGNE',
      connector,
    })
    expect(effet).toBe('VALIDE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.status).toBe('SIGNE')
    expect(demande.completedAt).not.toBeNull()
    expect(Array.from(demande.signedPdf!)).toEqual([0x25, 0x50, 0x44, 0x46, 0x53])
  })

  it('VALIDE VERROUILLE LE MOIS, quelle que soit la voie empruntée', async () => {
    await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'SIGNE',
      connector: createFakeSignatureConnector(),
    })

    const r = await saveEntry({ userId, lineId, date: '2026-06-02', minutes: 480, kind: 'REALISE' })
    expect(r).toEqual({ ok: false, reason: 'VERROUILLE' })
  })

  it('n archive jamais deux fois — un document signé se conserve, il ne se recalcule pas', async () => {
    const connector = createFakeSignatureConnector()
    connector.poserPdfSigne('ext-1', new Uint8Array([1, 2, 3]))
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector })

    connector.poserPdfSigne('ext-1', new Uint8Array([9, 9, 9]))
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector })

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(Array.from(demande.signedPdf!)).toEqual([1, 2, 3])
    expect(connector.telechargements).toEqual(['ext-1'])
  })

  it('N ÉCRASE PAS l archive quand la transition est de nouveau franchissable', async () => {
    // Le cas que l idempotence de la transition ne couvre pas : rouvrir puis
    // renvoyer **à la main** ramène le CRA à ENVOYE sans passer par
    // `sendCraForSignature`, donc sans effacer l archive. Une livraison
    // tardive du prestataire retéléchargerait alors par-dessus le document
    // que le client a réellement signé.
    const connector = createFakeSignatureConnector()
    connector.poserPdfSigne('ext-1', new Uint8Array([1, 2, 3]))
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector })

    await transitionCra(userId, craId, 'ROUVRIR')
    await transitionCra(userId, craId, 'ENVOYER')

    connector.poserPdfSigne('ext-1', new Uint8Array([9, 9, 9]))
    expect(
      await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector }),
    ).toBe('VALIDE')

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(Array.from(demande.signedPdf!)).toEqual([1, 2, 3])
    expect(connector.telechargements).toEqual(['ext-1'])
  })

  it('valide quand même si l archivage échoue — un téléchargement raté ne bloque rien', async () => {
    const connector = createFakeSignatureConnector()
    connector.faireEchouerTelechargement('Le prestataire est injoignable.')

    const effet = await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector })
    expect(effet).toBe('VALIDE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.signedPdf).toBeNull()
  })

  it('valide sans connecteur, en se passant simplement d archive', async () => {
    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'SIGNE',
      connector: null,
    })
    expect(effet).toBe('VALIDE')
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.signedPdf).toBeNull()
  })

  it('UN REFUS ROUVRE LE CRA', async () => {
    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'REFUSE',
      connector: createFakeSignatureConnector(),
    })
    expect(effet).toBe('REFUSE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('REFUSE')

    // Rouvrable, donc modifiable à nouveau.
    const r = await saveEntry({ userId, lineId, date: '2026-06-03', minutes: 480, kind: 'REALISE' })
    expect(r.ok).toBe(true)
  })

  it('un refus ne télécharge rien : il n y a pas de document signé à archiver', async () => {
    const connector = createFakeSignatureConnector()
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'REFUSE', connector })
    expect(connector.telechargements).toEqual([])
  })

  it('une expiration marque la demande sans toucher au CRA', async () => {
    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'EXPIRE',
      connector: createFakeSignatureConnector(),
    })
    expect(effet).toBe('EXPIRE')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.status).toBe('EXPIRE')
  })

  it('EN_ATTENTE ne fait rien', async () => {
    expect(
      await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'EN_ATTENTE', connector: null }),
    ).toBe('AUCUN')
    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.status).toBe('EN_ATTENTE')
  })

  it('est idempotent : appliquer SIGNE deux fois ne fait rien la seconde', async () => {
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector: null })
    expect(
      await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector: null }),
    ).toBe('AUCUN')
  })

  it('ne rouvre jamais un CRA déjà validé sur un refus tardif', async () => {
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector: null })
    expect(
      await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'REFUSE', connector: null }),
    ).toBe('AUCUN')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
    // Et la demande n a pas non plus été réécrite en REFUSE : le CRA et sa
    // demande racontent la même histoire.
    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.status).toBe('SIGNE')
  })

  it('ne fait rien sur un CRA inconnu', async () => {
    expect(
      await applySignatureStatus({ craId: 'inexistant', externalId: 'x', statut: 'SIGNE', connector: null }),
    ).toBe('AUCUN')
  })

  it('CONSIGNE `signature.recue` sur une signature, et rien sur un rejeu', async () => {
    await prisma.auditEvent.deleteMany({})

    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector: null })
    const apresUn = (await prisma.auditEvent.findMany({})).filter(
      (e) => e.action === 'signature.recue',
    )
    expect(apresUn, 'aucune entrée `signature.recue`').toHaveLength(1)
    expect(apresUn[0]!.entityId).toBe(craId)

    // Le rejeu n'a aucun effet : il ne doit pas non plus produire une seconde
    // entrée, sans quoi un abonné facturerait deux fois le même mois.
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector: null })
    expect(
      (await prisma.auditEvent.findMany({})).filter((e) => e.action === 'signature.recue'),
    ).toHaveLength(1)
  })

  it('CONSIGNE `signature.refusee` sur un refus', async () => {
    await prisma.auditEvent.deleteMany({})

    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'REFUSE', connector: null })

    const entrees = (await prisma.auditEvent.findMany({})).filter(
      (e) => e.action === 'signature.refusee',
    )
    expect(entrees, 'aucune entrée `signature.refusee`').toHaveLength(1)
    expect(entrees[0]!.entityId).toBe(craId)
  })

  it('ne consigne aucun événement de signature sur une expiration ni une attente', async () => {
    await prisma.auditEvent.deleteMany({})

    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'EN_ATTENTE', connector: null })
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'EXPIRE', connector: null })

    const actions = (await prisma.auditEvent.findMany({})).map((e) => e.action)
    expect(actions).not.toContain('signature.recue')
    expect(actions).not.toContain('signature.refusee')
  })

  it('MET LES TEMPS EN FILE VERS DOLIBARR, comme la validation manuelle', async () => {
    // Une signature du client **est** une validation. Écrire le statut à la
    // main ici court-circuiterait la seule mise en file du dépôt : le mois
    // serait verrouillé et rien ne partirait jamais chez Dolibarr — un échec
    // qu'aucun écran ne montre, jusqu'à la facture manquante.
    await armerDolibarr()

    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector: null })

    const lignes = await prisma.syncOutbox.findMany({ where: { entityId: craId } })
    expect(lignes).toHaveLength(1)
    expect(lignes[0]!.provider).toBe(DOLIBARR)
    expect(lignes[0]!.entityType).toBe(ENTITY_CRA)
    expect(lignes[0]!.userId).toBe(userId)
  })

  it('ne met rien en file sur un refus ni sur une expiration', async () => {
    await armerDolibarr()
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'EXPIRE', connector: null })
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'REFUSE', connector: null })
    expect(await prisma.syncOutbox.count()).toBe(0)
  })
})
