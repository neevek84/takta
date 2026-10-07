import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { prisma } from '@/db/client'
import { signWebhookPayload } from '@/core/signature/webhook'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import type { Mailer } from '@/services/notify'
import { createFakeSignatureConnector } from './fake-connector'
import { refreshSignatureStatus } from './refresh'
import { ENTITY_CRA, PROVIDER_DOCUMENSO } from './constants'
import { handleSignatureWebhook } from './webhook'

const SECRET = 'secret-de-webhook-de-test'

let userId = ''
let missionId = ''
let lineId = ''
let craId = ''

/** Charge v2 : l'enveloppe porte l'identifiant que `send` a rendu. */
function charge(event: string, envelopeId: string): string {
  return JSON.stringify({ event, payload: { id: 1, envelopeId } })
}

/** Le double rapporte, par défaut, l'état que la charge annonce. */
const ETAT_PAR_EVENEMENT: Record<string, 'SIGNE' | 'REFUSE' | 'EXPIRE'> = {
  DOCUMENT_COMPLETED: 'SIGNE',
  DOCUMENT_REJECTED: 'REFUSE',
  DOCUMENT_CANCELLED: 'EXPIRE',
}

async function recevoir(
  rawBody: string,
  options: {
    secret?: string
    signature?: string
    connector?: ReturnType<typeof createFakeSignatureConnector> | null
    mailer?: Mailer | null
  } = {},
) {
  // Le webhook relit l'état : sauf mention contraire, le prestataire (double)
  // confirme ce que la charge annonce, pour chaque enveloppe connue.
  const connector = options.connector ?? createFakeSignatureConnector()
  try {
    const { event, payload } = JSON.parse(rawBody) as {
      event: string
      payload: { envelopeId?: string }
    }
    const statut = ETAT_PAR_EVENEMENT[event]
    if (statut !== undefined && payload.envelopeId !== undefined) {
      connector.regler(payload.envelopeId, statut)
    }
  } catch {
    // charge illisible : le test attend un refus avant toute relecture
  }
  return handleSignatureWebhook({
    rawBody,
    // Une signature explicite (mauvaise) se teste seule : sans en-tête secret.
    secretHeader: options.signature !== undefined ? '' : (options.secret ?? SECRET),
    signatureHeader: options.signature ?? '',
    secret: SECRET,
    connector,
    mailer: options.mailer ?? (async () => {}),
  })
}

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'wh@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const c = await createClient('WH client')
  const m = await createMission({ clientId: c.id, label: 'M' })
  missionId = m.id
  lineId = (await createLine({ missionId, userId, label: 'L', soldCentiemes: 3000, tjmCents: 0 })).id
})

beforeEach(async () => {
  await prisma.signatureWebhookEvent.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })

  craId = (await getOrCreateCra(userId, missionId, '2026-06')).id
  await prisma.cra.update({ where: { id: craId }, data: { status: 'ENVOYE' } })
  await prisma.signatureRequest.create({
    data: {
      craId,
      provider: PROVIDER_DOCUMENSO,
      status: 'EN_ATTENTE',
      externalId: 'ext-1',
      signataireNom: 'Sam',
      signataireEmail: 'sam@client.test',
    },
  })
  await prisma.externalLink.create({
    data: {
      // `ExternalLink.userId` est obligatoire : le lien appartient au
      // propriétaire du CRA, et disparaît avec son compte.
      userId,
      entityType: ENTITY_CRA,
      entityId: craId,
      provider: PROVIDER_DOCUMENSO,
      externalId: 'ext-1',
      syncState: 'EN_ATTENTE',
    },
  })
})

afterAll(async () => {
  await prisma.signatureWebhookEvent.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { entityType: ENTITY_CRA } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'wh@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'WH client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('authentification', () => {
  it('REJETTE une charge mal signée', async () => {
    const r = await recevoir(charge('DOCUMENT_COMPLETED', 'ext-1'), { signature: 'sha256=' + '0'.repeat(64) })
    expect(r).toEqual({ ok: false, raison: 'SIGNATURE_INVALIDE' })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('REJETTE une charge modifiée après signature', async () => {
    const authentique = charge('DOCUMENT_COMPLETED', 'ext-1')
    const signature = signWebhookPayload(authentique, SECRET)
    const falsifiee = charge('DOCUMENT_COMPLETED', 'ext-2')

    const r = await handleSignatureWebhook({
      rawBody: falsifiee,
      secretHeader: '',
      signatureHeader: signature,
      secret: SECRET,
      connector: null,
    })
    expect(r).toEqual({ ok: false, raison: 'SIGNATURE_INVALIDE' })
  })

  it('rejette quand aucun secret n est configuré', async () => {
    const corps = charge('DOCUMENT_COMPLETED', 'ext-1')
    const r = await handleSignatureWebhook({
      rawBody: corps,
      secretHeader: '',
      signatureHeader: signWebhookPayload(corps, ''),
      secret: '',
      connector: null,
    })
    expect(r).toEqual({ ok: false, raison: 'SIGNATURE_INVALIDE' })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('rejette une charge illisible', async () => {
    expect(await recevoir('ceci n est pas du json')).toEqual({
      ok: false,
      raison: 'CHARGE_ILLISIBLE',
    })
  })

  it('rejette un événement sans correspondance connue', async () => {
    expect(await recevoir(charge('DOCUMENT_OPENED', 'ext-1'))).toEqual({
      ok: false,
      raison: 'CHARGE_ILLISIBLE',
    })
  })

  it('rend LIEN_INCONNU pour une référence externe qu on ne connaît pas', async () => {
    expect(await recevoir(charge('DOCUMENT_COMPLETED', 'ext-9999'))).toEqual({
      ok: false,
      raison: 'LIEN_INCONNU',
    })
  })

  it('UN LIEN INCONNU NE BRÛLE PAS L IDENTIFIANT D ÉVÉNEMENT', async () => {
    // La course réelle : le prestataire livre `DOCUMENT_COMPLETED` pendant que
    // `sendCraForSignature` n'a pas encore écrit son `ExternalLink` — son
    // `connector.send` a déjà déclenché le courriel côté Documenso. Consigner
    // l'événement avant de résoudre le lien rendait cette livraison
    // définitivement perdue : toute relivraison rendait `REJOUE`, et la route
    // répond 202 pour que le prestataire cesse de réessayer. Deux barrières
    // conçues pour se compléter s'annulaient.
    const corps = charge('DOCUMENT_COMPLETED', 'ext-7777')

    expect(await recevoir(corps)).toEqual({ ok: false, raison: 'LIEN_INCONNU' })
    expect(
      await prisma.signatureWebhookEvent.count(),
      'l’identifiant a été consigné alors que rien n’a été fait',
    ).toBe(0)

    // Le lien arrive — l'envoi a fini de s'écrire — et le prestataire relivre.
    await prisma.externalLink.updateMany({
      where: { entityType: ENTITY_CRA, entityId: craId, provider: PROVIDER_DOCUMENSO },
      data: { externalId: 'ext-7777' },
    })
    await prisma.signatureRequest.update({ where: { craId }, data: { externalId: 'ext-7777' } })

    const relivraison = await recevoir(corps)
    expect(relivraison).toEqual({ ok: true, effet: 'VALIDE', craId })
    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
  })

  it('une charge illisible ne brûle pas non plus d identifiant', async () => {
    await recevoir('ceci n est pas du json')
    expect(await prisma.signatureWebhookEvent.count()).toBe(0)
  })
})

describe('effet', () => {
  it('UNE CHARGE VALIDE FAIT FRANCHIR LA TRANSITION ET VERROUILLE LE MOIS', async () => {
    const r = await recevoir(charge('DOCUMENT_COMPLETED', 'ext-1'), {
      connector: createFakeSignatureConnector(),
    })
    expect(r).toEqual({ ok: true, effet: 'VALIDE', craId })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')

    const ecriture = await saveEntry({
      userId,
      lineId,
      date: '2026-06-02',
      minutes: 480,
      kind: 'REALISE',
    })
    expect(ecriture).toEqual({ ok: false, reason: 'VERROUILLE' })
  })

  it('UN WEBHOOK REJOUÉ DEUX FOIS N A AUCUN EFFET LA SECONDE', async () => {
    const corps = charge('DOCUMENT_COMPLETED', 'ext-1')
    expect((await recevoir(corps)).ok).toBe(true)

    // Le CRA est rouvert **puis renvoyé** entre-temps : c'est le seul montage
    // où l'idempotence du webhook se distingue de celle de la transition.
    // S'arrêter à ROUVRIR laisserait le CRA en BROUILLON, d'où VALIDER n'est
    // de toute façon pas franchissable — le rejeu paraîtrait sans effet même
    // si l'événement n'était consigné qu'après avoir agi, et la garde du
    // webhook pourrait disparaître sans qu'aucune assertion ne bouge.
    await transitionCra(userId, craId, 'ROUVRIR')
    await transitionCra(userId, craId, 'ENVOYER')

    const rejeu = await recevoir(corps)
    expect(rejeu).toEqual({ ok: true, effet: 'REJOUE', craId: null })

    // Le CRA n'a pas été revalidé par une livraison déjà traitée. (Depuis le
    // lot 3b `ENVOYE` ferme lui-même la saisie : « le mois reste modifiable »
    // ne distingue plus rien, seul le statut porte la preuve.)
    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('un rejeu ne consigne pas un second événement', async () => {
    const corps = charge('DOCUMENT_COMPLETED', 'ext-1')
    await recevoir(corps)
    await recevoir(corps)
    expect(await prisma.signatureWebhookEvent.count()).toBe(1)
  })

  it('un refus fait passer à REFUSE et rouvre le CRA à l écriture', async () => {
    const r = await recevoir(charge('DOCUMENT_REJECTED', 'ext-1'))
    expect(r).toEqual({ ok: true, effet: 'REFUSE', craId })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('REFUSE')
    expect((await saveEntry({ userId, lineId, date: '2026-06-04', minutes: 480, kind: 'REALISE' })).ok).toBe(true)
  })

  it('archive le PDF signé', async () => {
    const connector = createFakeSignatureConnector()
    connector.poserPdfSigne('ext-1', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x53]))
    await recevoir(charge('DOCUMENT_COMPLETED', 'ext-1'), { connector })

    const demande = await prisma.signatureRequest.findUniqueOrThrow({ where: { craId } })
    expect(Array.from(demande.signedPdf!)).toEqual([0x25, 0x50, 0x44, 0x46, 0x53])
  })

  it('une annulation marque l expiration sans toucher au CRA', async () => {
    const r = await recevoir(charge('DOCUMENT_CANCELLED', 'ext-1'))
    expect(r).toEqual({ ok: true, effet: 'EXPIRE', craId })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('ENVOYE')
  })

  it('inscrit l état rapporté sur le lien externe', async () => {
    await recevoir(charge('DOCUMENT_COMPLETED', 'ext-1'))
    const lien = await prisma.externalLink.findFirstOrThrow({
      where: { entityType: ENTITY_CRA, entityId: craId },
    })
    expect(lien.syncState).toBe('SIGNE')
    expect(lien.syncedAt).not.toBeNull()
  })

  it('consigne l événement traité, une seule fois', async () => {
    await recevoir(charge('DOCUMENT_COMPLETED', 'ext-1'))
    await recevoir(charge('DOCUMENT_COMPLETED', 'ext-1'))

    const evenements = await prisma.signatureWebhookEvent.findMany({})
    expect(evenements).toHaveLength(1)
    expect(evenements[0]!.eventId).toBe('DOCUMENT_COMPLETED:ext-1')
  })

  it('ne consigne rien quand la signature est mauvaise', async () => {
    await recevoir(charge('DOCUMENT_COMPLETED', 'ext-1'), { signature: 'sha256=' + '0'.repeat(64) })
    expect(await prisma.signatureWebhookEvent.count()).toBe(0)
  })

  it('ne consigne rien quand la charge est illisible', async () => {
    await recevoir('pas du json')
    expect(await prisma.signatureWebhookEvent.count()).toBe(0)
  })
})

describe('lot 3b — le webhook est un signal, pas une source de vérité', () => {
  const connector = createFakeSignatureConnector()

  const recevoirSecret = (rawBody: string, secretHeader: string, mailer?: Mailer) =>
    handleSignatureWebhook({
      rawBody,
      secretHeader,
      signatureHeader: '',
      secret: SECRET,
      connector,
      mailer: mailer ?? (async () => {}),
    })

  it('accepte X-Documenso-Secret, tel que Documenso l envoie', async () => {
    connector.regler('ext-1', 'SIGNE')
    const r = await recevoirSecret(charge('DOCUMENT_COMPLETED', 'ext-1'), SECRET)
    expect(r).toMatchObject({ ok: true, effet: 'VALIDE' })
  })

  it('refuse un secret faux ou absent', async () => {
    for (const secretHeader of ['', 'faux']) {
      const r = await recevoirSecret(charge('DOCUMENT_COMPLETED', 'ext-1'), secretHeader)
      expect(r).toEqual({ ok: false, raison: 'SIGNATURE_INVALIDE' })
    }
  })

  it('UNE CHARGE QUI DIT « SIGNÉ » NE VALIDE RIEN si le prestataire dit « en attente »', async () => {
    connector.regler('ext-1', 'EN_ATTENTE')
    const r = await recevoirSecret(charge('DOCUMENT_COMPLETED', 'ext-1'), SECRET)
    expect(r).toMatchObject({ ok: true, effet: 'AUCUN' })
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('ENVOYE')
  })

  it("prestataire injoignable : rien n'est consommé, la relivraison pourra agir", async () => {
    const panne = createFakeSignatureConnector()
    panne.faireEchouerStatut('panne')
    const r1 = await handleSignatureWebhook({
      rawBody: charge('DOCUMENT_COMPLETED', 'ext-1'),
      secretHeader: SECRET,
      signatureHeader: '',
      secret: SECRET,
      connector: panne,
    })
    expect(r1).toEqual({ ok: false, raison: 'PRESTATAIRE_INJOIGNABLE' })
    expect(await prisma.signatureWebhookEvent.count()).toBe(0)
  })

  it('reconnaît un envoi hérité par son identifiant numérique', async () => {
    await prisma.externalLink.updateMany({
      where: { entityId: craId },
      data: { externalId: '42' },
    })
    await prisma.signatureRequest.update({ where: { craId }, data: { externalId: '' } })
    connector.regler('42', 'SIGNE')
    const r = await recevoirSecret(
      JSON.stringify({
        event: 'DOCUMENT_COMPLETED',
        payload: { id: 42, envelopeId: 'envelope_inconnue' },
      }),
      SECRET,
    )
    expect(r).toMatchObject({ ok: true, effet: 'VALIDE' })
  })

  it('webhook puis confirmation de page : un seul effet, un seul couple de courriels', async () => {
    connector.regler('ext-1', 'SIGNE')
    const envoyes: string[] = []
    const mailer: Mailer = async (m) => {
      envoyes.push(m.to)
    }
    await recevoirSecret(charge('DOCUMENT_COMPLETED', 'ext-1'), SECRET, mailer)
    await refreshSignatureStatus(userId, craId, { connector, mailer })
    expect(envoyes).toHaveLength(2)
    const recues = await prisma.auditEvent.count({
      where: { entityId: craId, action: 'signature.recue' },
    })
    expect(recues).toBe(1)
  })
})
