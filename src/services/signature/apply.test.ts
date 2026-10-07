import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import type { Mailer } from '@/services/notify'
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

// Une fenêtre de course rendue déterministe : `course.avant`, s'il est posé,
// s'exécute une fois juste avant la transition que demande l'applicateur —
// c'est-à-dire après sa lecture et sa réclamation. Sans effet sinon.
const course = vi.hoisted(() => ({ avant: null as null | (() => Promise<unknown>) }))

vi.mock('@/services/cra', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@/services/cra')>()
  return {
    ...reel,
    transitionCra: async (...args: Parameters<typeof reel.transitionCra>) => {
      const avant = course.avant
      course.avant = null
      if (avant !== null) await avant()
      return reel.transitionCra(...args)
    },
  }
})

const EMAIL_CONSULTANT = 'apply@test.local'
const EMAIL_SIGNATAIRE = 'signataire-apply@client.test'

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
    data: { email: EMAIL_CONSULTANT, name: 'T', passwordHash: 'x' },
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
    data: {
      craId,
      provider: 'double',
      status: 'EN_ATTENTE',
      externalId: 'ext-1',
      signataireNom: 'Sam Signataire',
      signataireEmail: EMAIL_SIGNATAIRE,
    },
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

  it('N ÉCRASE PAS l archive, ni ne revalide, quand la transition est de nouveau franchissable', async () => {
    // Le cas que l idempotence de la transition ne couvre pas : rouvrir puis
    // renvoyer **à la main** ramène le CRA à ENVOYE sans passer par
    // `sendCraForSignature`, donc sans effacer l archive. Une livraison
    // tardive du prestataire retéléchargerait alors par-dessus le document
    // que le client a réellement signé.
    //
    // Depuis la revue finale du lot 3b, la demande déjà SIGNE n'est plus
    // réclamable : la relivraison ne revalide pas non plus un mois qui a pu
    // changer depuis la signature. Le consultant valide à la main.
    const connector = createFakeSignatureConnector()
    connector.poserPdfSigne('ext-1', new Uint8Array([1, 2, 3]))
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector })

    await transitionCra(userId, craId, 'ROUVRIR')
    await transitionCra(userId, craId, 'ENVOYER')

    connector.poserPdfSigne('ext-1', new Uint8Array([9, 9, 9]))
    expect(
      await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector }),
    ).toBe('AUCUN')
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('ENVOYE')

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

describe('lot 3b — issue du circuit', () => {
  let courriels: Array<{ to: string; sujet: string; pieces: number }> = []
  const mailer: Mailer = async (m) => {
    courriels.push({ to: m.to, sujet: m.sujet, pieces: m.pieces?.length ?? 0 })
  }
  beforeEach(() => {
    courriels = []
  })

  it('un refus enregistre le motif et écrit au consultant ET au client, sans pièce jointe', async () => {
    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'REFUSE',
      motifRefus: 'Il manque le 15.',
      mailer,
    })
    expect(effet).toBe('REFUSE')
    const d = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(d.motifRefus).toBe('Il manque le 15.')
    expect(courriels.map((c) => c.to).sort()).toEqual([EMAIL_CONSULTANT, EMAIL_SIGNATAIRE].sort())
    expect(courriels.every((c) => c.pieces === 0)).toBe(true)
  })

  it('une signature écrit aux deux, PDF signé joint', async () => {
    const connector = createFakeSignatureConnector()
    connector.poserPdfSigne('ext-1', new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector, mailer })
    expect(courriels).toHaveLength(2)
    expect(courriels.every((c) => c.pieces === 1)).toBe(true)
  })

  it('sans archive (téléchargement en échec), écrit quand même — sans pièce jointe', async () => {
    const connector = createFakeSignatureConnector()
    connector.faireEchouerTelechargement('panne')
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', connector, mailer })
    expect(courriels).toHaveLength(2)
    expect(courriels.every((c) => c.pieces === 0)).toBe(true)
  })

  it("UN REJEU N'ÉCRIT PAS DEUX FOIS", async () => {
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', mailer })
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', mailer })
    expect(courriels).toHaveLength(2)
  })

  it("ignore l'état d'une ancienne enveloppe : seul l'envoi en cours fait foi", async () => {
    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-ancienne',
      statut: 'SIGNE',
      mailer,
    })
    expect(effet).toBe('AUCUN')
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('ENVOYE')
    expect(courriels).toHaveLength(0)
  })

  it('ignore une demande annulée', async () => {
    await prisma.signatureRequest.update({ where: { craId }, data: { status: 'ANNULE' } })
    expect(
      await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', mailer }),
    ).toBe('AUCUN')
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('ENVOYE')
  })

  // Revue finale lot 3b : la page client, les webhooks et le balayage peuvent
  // appliquer la même signature au même instant.
  it('DEUX SIGNATURES CONCURRENTES : un seul signature.recue, un seul cra.valide, deux courriels', async () => {
    await prisma.auditEvent.deleteMany({})

    const effets = await Promise.all([
      applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', mailer }),
      applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', mailer }),
    ])

    expect([...effets].sort()).toEqual(['AUCUN', 'VALIDE'])
    const actions = (await prisma.auditEvent.findMany({})).map((e) => e.action)
    expect(actions.filter((a) => a === 'signature.recue')).toHaveLength(1)
    expect(actions.filter((a) => a === 'cra.valide')).toHaveLength(1)
    expect(courriels).toHaveLength(2)
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('VALIDE')
  })

  it('le CRA a quitté ENVOYE pendant la réclamation : AUCUN, ni courriel ni journal, demande restaurée', async () => {
    // Une transition manuelle passe entre la réclamation de la demande et la
    // transition de l'applicateur : `transitionCra` lève, l'applicateur rend
    // AUCUN et remet la demande dans l'état où il l'a trouvée.
    await prisma.auditEvent.deleteMany({})
    course.avant = () => prisma.cra.update({ where: { id: craId }, data: { status: 'VALIDE' } })

    const effet = await applySignatureStatus({
      craId,
      externalId: 'ext-1',
      statut: 'REFUSE',
      motifRefus: 'Il manque le 15.',
      mailer,
    })

    expect(effet).toBe('AUCUN')
    expect(courriels).toHaveLength(0)
    const actions = (await prisma.auditEvent.findMany({})).map((e) => e.action)
    expect(actions).not.toContain('signature.refusee')
    expect(actions).not.toContain('cra.refuse')
    const d = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(d.status).toBe('EN_ATTENTE')
    expect(d.completedAt).toBeNull()
    expect(d.motifRefus).toBe('')
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('VALIDE')
  })

  it('une expiration tardive n écrase pas une demande déjà signée', async () => {
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', mailer })
    expect(
      await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'EXPIRE', mailer }),
    ).toBe('AUCUN')
    expect((await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })).status).toBe('SIGNE')
  })

  it('une signature met les temps en file pour Dolibarr, comme une validation manuelle', async () => {
    await armerDolibarr()
    await applySignatureStatus({ craId, externalId: 'ext-1', statut: 'SIGNE', mailer })
    expect(
      await prisma.syncOutbox.count({ where: { entityId: craId, provider: DOLIBARR } }),
    ).toBe(1)
  })
})
