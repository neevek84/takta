import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import { createFakeSignatureConnector } from './fake-connector'
import { ENTITY_CRA } from './constants'
import { refreshPendingSignatures, refreshSignatureStatus } from './refresh'

let userId = ''
let autreUserId = ''
let missionId = ''
let lineId = ''
let craId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'refresh@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'refresh-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreUserId = a.id

  const c = await createClient('REFRESH client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  lineId = (await createLine({ missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })

  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
  await prisma.cra.update({ where: { id: craId }, data: { status: 'ENVOYE' } })
})

afterAll(async () => {
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({
    where: { email: { in: ['refresh@test.local', 'refresh-autre@test.local'] } },
  })
  await prisma.client.deleteMany({ where: { name: 'REFRESH client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

async function demandeEnCours(provider = 'double'): Promise<void> {
  await prisma.signatureRequest.create({ data: { craId, provider, status: 'EN_ATTENTE' } })
  await prisma.externalLink.create({
    data: {
      // `ExternalLink.userId` est obligatoire : le lien suit son propriétaire.
      userId,
      entityType: ENTITY_CRA,
      entityId: craId,
      provider,
      externalId: 'ext-1',
      syncState: 'EN_ATTENTE',
    },
  })
}

describe('refreshSignatureStatus', () => {
  it('UN WEBHOOK PERDU EST RATTRAPÉ PAR LE RAFRAÎCHISSEMENT', async () => {
    // Le client a signé, aucun webhook n est arrivé. Le bouton suffit.
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')
    connector.poserPdfSigne('ext-1', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53]))

    const r = await refreshSignatureStatus(userId, craId, { connector })
    expect(r).toEqual({ ok: true, statut: 'SIGNE', effet: 'VALIDE' })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')

    const ecriture = await saveEntry({ userId, lineId, date: '2026-06-02', minutes: 480, kind: 'REALISE' })
    expect(ecriture).toEqual({ ok: false, reason: 'VERROUILLE' })

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(demande.signedPdf).not.toBeNull()
  })

  it('ne change rien tant que le prestataire dit « en attente »', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'EN_ATTENTE')

    expect(await refreshSignatureStatus(userId, craId, { connector })).toEqual({
      ok: true,
      statut: 'EN_ATTENTE',
      effet: 'AUCUN',
    })
    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
    // Et rien n a été téléchargé : il n y a pas encore de document signé.
    expect(connector.telechargements).toEqual([])
  })

  it('rattrape aussi un refus', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'REFUSE')

    expect((await refreshSignatureStatus(userId, craId, { connector })).ok).toBe(true)
    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('REFUSE')
  })

  it('rattrape l archive quand la signature était déjà appliquée sans PDF', async () => {
    // Le webhook a validé le CRA, mais le téléchargement avait échoué.
    await demandeEnCours()
    await prisma.cra.update({ where: { id: craId }, data: { status: 'VALIDE' } })
    await prisma.signatureRequest.update({
      where: { craId },
      data: { status: 'SIGNE', completedAt: new Date() },
    })

    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')
    connector.poserPdfSigne('ext-1', new Uint8Array([1, 2, 3]))

    const r = await refreshSignatureStatus(userId, craId, { connector })
    expect(r.ok).toBe(true)

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(Array.from(demande.signedPdf!)).toEqual([1, 2, 3])

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
  })

  it('N ÉCRASE PAS une archive déjà en place', async () => {
    // Le pendant du rattrapage : rafraîchir deux fois ne doit pas
    // retélécharger par-dessus le document que le client a signé.
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')
    connector.poserPdfSigne('ext-1', new Uint8Array([1, 2, 3]))
    await refreshSignatureStatus(userId, craId, { connector })

    connector.poserPdfSigne('ext-1', new Uint8Array([9, 9, 9]))
    await refreshSignatureStatus(userId, craId, { connector })

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(Array.from(demande.signedPdf!)).toEqual([1, 2, 3])
    expect(connector.telechargements).toEqual(['ext-1'])
  })

  it('le dit quand aucune demande n a été ouverte', async () => {
    const r = await refreshSignatureStatus(userId, craId, {
      connector: createFakeSignatureConnector(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_DEMANDE')
  })

  it('le dit quand aucun connecteur n est configuré', async () => {
    await demandeEnCours()
    const r = await refreshSignatureStatus(userId, craId, { connector: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_CONNECTEUR')
  })

  it('LA TRANSITION MANUELLE RESTE POSSIBLE quand le connecteur est muet', async () => {
    await demandeEnCours()
    await refreshSignatureStatus(userId, craId, { connector: null })

    const apres = await transitionCra(userId, craId, 'VALIDER')
    expect(apres.status).toBe('VALIDE')
    expect(
      await saveEntry({ userId, lineId, date: '2026-06-05', minutes: 480, kind: 'REALISE' }),
    ).toEqual({ ok: false, reason: 'VERROUILLE' })
  })

  it('ne casse rien quand le prestataire est injoignable', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')
    const enPanne = { ...connector, status: async () => { throw new Error('injoignable') } }

    const r = await refreshSignatureStatus(userId, craId, { connector: enPanne })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('CONNECTEUR_EN_ECHEC')

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('refuse le CRA d un autre utilisateur', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')

    const r = await refreshSignatureStatus(autreUserId, craId, { connector })
    expect(r.ok).toBe(false)

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
    // Et rien n a été demandé au prestataire au nom d un autre.
    expect(connector.telechargements).toEqual([])
  })

  it('rend PAS_DE_DEMANDE quand la demande existe mais que le lien externe manque', async () => {
    await prisma.signatureRequest.create({
      data: { craId, provider: 'double', status: 'EN_ATTENTE' },
    })
    const r = await refreshSignatureStatus(userId, craId, {
      connector: createFakeSignatureConnector(),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.raison).toBe('PAS_DE_DEMANDE')
  })

  it('inscrit l état rapporté sur le lien externe', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'EXPIRE')

    await refreshSignatureStatus(userId, craId, { connector })
    const lien = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: ENTITY_CRA, entityId: craId },
    })
    expect(lien.syncState).toBe('EXPIRE')
  })
})

describe('refreshPendingSignatures', () => {
  it('BALAIE LES DEMANDES EN COURS DE L INSTANCE, sans session', async () => {
    // C'est ce que l'ordonnanceur appelle : un réveil externe n'a pas de
    // session, et une demande appartient au compte du CRA, pas à l'appelant.
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')

    const rapport = await refreshPendingSignatures({ connector })

    expect(rapport).toMatchObject({ examinees: 1, valides: 1 })
    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
  })

  it('n interroge pas le prestataire sur une demande déjà achevée', async () => {
    await demandeEnCours()
    await prisma.signatureRequest.update({
      where: { craId },
      data: { status: 'SIGNE', completedAt: new Date() },
    })
    const connector = createFakeSignatureConnector()

    const rapport = await refreshPendingSignatures({ connector })

    expect(rapport.examinees).toBe(0)
    expect(connector.interrogations).toEqual([])
  })

  it('N INTERROGE PAS le prestataire sur un CRA qui a quitté l état ENVOYE', async () => {
    // Le pendant de la relance : un CRA validé à la main garde une demande
    // `EN_ATTENTE`. Le balayage n'a rien à y appliquer, et interroger le
    // prestataire à son sujet n'apprendrait rien à personne.
    await demandeEnCours()
    await prisma.cra.update({ where: { id: craId }, data: { status: 'VALIDE' } })
    const connector = createFakeSignatureConnector()

    expect((await refreshPendingSignatures({ connector })).examinees).toBe(0)
    expect(connector.interrogations).toEqual([])
  })

  it('SANS CONNECTEUR, ne compte rien et n échoue pas', async () => {
    await demandeEnCours()
    expect(await refreshPendingSignatures({ connector: null })).toEqual({
      examinees: 0,
      valides: 0,
      refusees: 0,
      expirees: 0,
      inchangees: 0,
      echecs: 0,
    })
  })

  it('un prestataire injoignable compte un échec sans arrêter le balayage', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    const enPanne = {
      ...connector,
      status: async () => {
        throw new Error('injoignable')
      },
    }

    const rapport = await refreshPendingSignatures({ connector: enPanne })
    expect(rapport).toMatchObject({ examinees: 1, echecs: 1 })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('se scope sur un utilisateur quand on le lui demande', async () => {
    await demandeEnCours()
    const connector = createFakeSignatureConnector()
    connector.regler('ext-1', 'SIGNE')

    expect((await refreshPendingSignatures({ userId: autreUserId, connector })).examinees).toBe(0)
    expect((await refreshPendingSignatures({ userId, connector })).examinees).toBe(1)
  })
})
