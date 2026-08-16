import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { updateSettings } from '@/services/settings'
import { saveInstanceCredential } from '@/services/credentials'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { FakeDolibarr } from './fake'
import { DOLIBARR } from './api'
import { previewCraInvoice, requestCraInvoice } from './invoicing'

let userId = ''
let clientId = ''
let missionId = ''
let lineId = ''

/** Second client, avec son propre tiers : c'est lui qui rend le mauvais tiers observable. */
let autreClientId = ''
let autreMissionId = ''
let autreLineId = ''

let api: FakeDolibarr
/** Identifiants rendus par le double ; jamais des constantes inventées. */
let tiersId = 0
let autreTiersId = 0

async function craValide(month: string, mission = missionId): Promise<string> {
  const cra = await getOrCreateCra(userId, mission, month)
  await transitionCra(userId, cra.id, 'ENVOYER')
  await transitionCra(userId, cra.id, 'VALIDER')
  return cra.id
}

async function lierTiers(client: string, externalId: number | string): Promise<void> {
  await prisma.externalLink.create({
    data: {
      userId,
      entityType: 'Client',
      entityId: client,
      provider: DOLIBARR,
      externalId: String(externalId),
    },
  })
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

  const u = await prisma.user.create({
    data: { email: 'facture@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id

  const c = await createClient('FACTURE client')
  clientId = c.id
  const m = await createMission({ clientId, label: 'FACTURE mission' })
  missionId = m.id
  lineId = (
    await createLine({
      missionId,
      userId,
      label: 'Développement',
      soldCentiemes: 3000,
      tjmCents: 80_000,
    })
  ).id

  const c2 = await createClient('FACTURE client bis')
  autreClientId = c2.id
  const m2 = await createMission({ clientId: autreClientId, label: 'FACTURE mission bis' })
  autreMissionId = m2.id
  autreLineId = (
    await createLine({
      missionId: autreMissionId,
      userId,
      label: 'Maintenance',
      soldCentiemes: 3000,
      tjmCents: 50_000,
    })
  ).id
})

beforeEach(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })

  await saveInstanceCredential({
    provider: DOLIBARR,
    secret: 'cle-de-test',
    baseUrl: 'https://dolibarr.invalid/api/index.php',
    metadata: { dolibarrUserId: '7' },
  })

  api = new FakeDolibarr()
  // Le double refuse un `socid` inconnu, comme une instance : les deux tiers
  // existent réellement dans le Dolibarr de test avant qu'on y renvoie.
  tiersId = api.seedThirdparty('FACTURE client').id
  autreTiersId = api.seedThirdparty('FACTURE client bis').id

  await lierTiers(clientId, tiersId)
  await lierTiers(autreClientId, autreTiersId)
})

afterAll(async () => {
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.externalLink.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
  await prisma.user.deleteMany({ where: { email: 'facture@test.local' } })
  await prisma.client.deleteMany({
    where: { name: { in: ['FACTURE client', 'FACTURE client bis'] } },
  })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

describe('proposition de facture', () => {
  it('propose les jours validés au TJM de la prestation', async () => {
    for (let j = 1; j <= 20; j++) {
      await saveEntry({
        userId,
        lineId,
        date: `2026-05-${String(j).padStart(2, '0')}`,
        minutes: 480,
        kind: 'REALISE',
      })
    }
    const craId = await craValide('2026-05')

    const draft = await previewCraInvoice({ userId, craId })
    expect(draft!.socid).toBe(tiersId)
    expect(draft!.month).toBe('2026-05')
    expect(draft!.lines[0]!.qteCentiemes).toBe(2000)
    expect(draft!.totalHtCents).toBe(1_600_000)
  })

  it('ne propose rien sur un CRA non validé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const cra = await getOrCreateCra(userId, missionId, '2026-05')
    expect(await previewCraInvoice({ userId, craId: cra.id })).toBeNull()
  })

  it('ne propose rien sans tiers Dolibarr rattaché', async () => {
    await prisma.externalLink.deleteMany({ where: { entityType: 'Client' } })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    expect(await previewCraInvoice({ userId, craId })).toBeNull()
  })

  it('ne propose rien quand le mois ne porte aucun réalisé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'PREVISIONNEL' })
    const craId = await craValide('2026-05')
    expect(await previewCraInvoice({ userId, craId })).toBeNull()
  })

  it('ne propose rien quand Dolibarr n est pas connecté', async () => {
    // Déconnecter laisse les rattachements en place, exprès : ce sont eux, et
    // non la clé, que la lecture du tiers trouve. Sans la garde, l'écran
    // proposerait une facture que plus rien ne peut demander.
    await prisma.providerCredential.deleteMany({ where: { provider: DOLIBARR } })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    expect(await previewCraInvoice({ userId, craId })).toBeNull()
  })

  it('ne propose pas le CRA d un autre utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-facture@test.local', name: 'A', passwordHash: 'x' },
    })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    expect(await previewCraInvoice({ userId: autre.id, craId })).toBeNull()

    await prisma.user.delete({ where: { id: autre.id } })
  })
})

describe('demande de facture', () => {
  it('crée une facture au brouillon, sans numéro ni TVA choisis par l application', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const r = await requestCraInvoice({ userId, craId, api })
    expect(r.ok).toBe(true)
    expect(api.invoices).toHaveLength(1)
    expect(api.invoices[0]!.status).toBe(0)
    expect(api.invoices[0]!.socid).toBe(tiersId)
    expect(api.invoices[0]!.lines[0]!.qty).toBe(1)
    expect(api.invoices[0]!.lines[0]!.subprice).toBe(800)
  })

  it('ne crée pas de seconde facture sur une seconde demande', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const a = await requestCraInvoice({ userId, craId, api })
    const b = await requestCraInvoice({ userId, craId, api })

    expect(api.invoices).toHaveLength(1)
    expect(b).toEqual({ ...a, deja: true })
  })

  it('refuse sur un CRA non validé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const cra = await getOrCreateCra(userId, missionId, '2026-05')

    const r = await requestCraInvoice({ userId, craId: cra.id, api })
    expect(r).toEqual({
      ok: false,
      reason: 'NON_VALIDE',
      message: expect.stringContaining('validé'),
    })
    expect(api.invoices).toEqual([])
  })

  it('refuse, en le disant, quand le client n est rattaché à aucun tiers', async () => {
    await prisma.externalLink.deleteMany({ where: { entityType: 'Client' } })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const r = await requestCraInvoice({ userId, craId, api })
    expect(r).toEqual({
      ok: false,
      reason: 'SANS_TIERS',
      message: expect.stringContaining('tiers Dolibarr'),
    })
    expect(api.invoices).toEqual([])
  })

  it('laisse le CRA validé et les temps poussés quand Dolibarr est indisponible', async () => {
    // Le refus de la proposition, ou son échec, n'a aucune conséquence.
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    api.panne = true

    const r = await requestCraInvoice({ userId, craId, api })
    expect(r).toEqual({
      ok: false,
      reason: 'INDISPONIBLE',
      message: expect.stringContaining('à la main'),
    })

    const cra = await prisma.cra.findUniqueOrThrow({ where: { id: craId } })
    expect(cra.status).toBe('VALIDE')
  })

  it('rejoue la demande après une panne, sans doublon ni facture perdue', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    api.panne = true
    expect((await requestCraInvoice({ userId, craId, api })).ok).toBe(false)
    expect(api.invoices).toEqual([])

    api.panne = false
    const r = await requestCraInvoice({ userId, craId, api })
    expect(r.ok).toBe(true)
    expect(api.invoices).toHaveLength(1)
  })

  it('dit que Dolibarr a refusé, sans prétendre qu il est injoignable', async () => {
    // Tiers effacé dans Dolibarr depuis le rattachement : l'instance répond,
    // et refuse. Rejouer à l'identique n'aboutira jamais — annoncer une panne
    // ferait recliquer indéfiniment sur un bouton qui ne marchera plus.
    await prisma.externalLink.deleteMany({ where: { entityType: 'Client' } })
    await lierTiers(clientId, 9999)
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const r = await requestCraInvoice({ userId, craId, api })
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ reason: 'REFUSEE' })
    expect(api.invoices).toEqual([])
    // Rien n'est mémorisé : il n'y a aucune facture à retrouver.
    expect(
      await prisma.externalLink.count({ where: { entityType: 'CraInvoice' } }),
    ).toBe(0)
  })

  it('refuse quand le mois ne porte aucun réalisé', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'PREVISIONNEL' })
    const craId = await craValide('2026-05')

    const r = await requestCraInvoice({ userId, craId, api })
    expect(r).toEqual({
      ok: false,
      reason: 'SANS_LIGNE',
      message: expect.stringContaining('aucun temps réalisé'),
    })
    expect(api.invoices).toEqual([])
  })

  it('ne facture jamais de prévisionnel', async () => {
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-05-05', minutes: 480, kind: 'PREVISIONNEL' })
    const craId = await craValide('2026-05')

    await requestCraInvoice({ userId, craId, api })
    expect(api.invoices[0]!.lines[0]!.qty).toBe(1)
  })

  it('ne facture que le mois et la mission du CRA', async () => {
    // Même prestation, mois voisin ; et le même mois sur une autre mission.
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    await saveEntry({ userId, lineId, date: '2026-06-02', minutes: 480, kind: 'REALISE' })
    await saveEntry({
      userId,
      lineId: autreLineId,
      date: '2026-05-05',
      minutes: 480,
      kind: 'REALISE',
    })
    const craId = await craValide('2026-05')

    await requestCraInvoice({ userId, craId, api })
    expect(api.invoices[0]!.lines).toHaveLength(1)
    expect(api.invoices[0]!.lines[0]!.qty).toBe(1)
    expect(api.invoices[0]!.lines[0]!.label).toBe('Développement')
  })

  it('facture au tiers du client de la mission, jamais à celui d un autre', async () => {
    await saveEntry({
      userId,
      lineId: autreLineId,
      date: '2026-05-05',
      minutes: 480,
      kind: 'REALISE',
    })
    const craId = await craValide('2026-05', autreMissionId)

    const r = await requestCraInvoice({ userId, craId, api })
    expect(r.ok).toBe(true)
    expect(api.invoices[0]!.socid).toBe(autreTiersId)
    expect(api.invoices[0]!.socid).not.toBe(tiersId)
  })

  it('ne facture pas le CRA d un autre utilisateur', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-facture@test.local', name: 'A', passwordHash: 'x' },
    })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')

    const r = await requestCraInvoice({ userId: autre.id, craId, api })
    expect(r.ok).toBe(false)
    expect(api.invoices).toEqual([])

    await prisma.user.delete({ where: { id: autre.id } })
  })

  it('ne révèle pas la facture d un CRA qui appartient à quelqu un d autre', async () => {
    const autre = await prisma.user.create({
      data: { email: 'autre-facture@test.local', name: 'A', passwordHash: 'x' },
    })
    await saveEntry({ userId, lineId, date: '2026-05-04', minutes: 480, kind: 'REALISE' })
    const craId = await craValide('2026-05')
    expect((await requestCraInvoice({ userId, craId, api })).ok).toBe(true)

    // La correspondance existe désormais : la lire avant de contrôler le
    // propriétaire rendrait l'identifiant de la facture à n'importe qui.
    const r = await requestCraInvoice({ userId: autre.id, craId, api })
    expect(r.ok).toBe(false)

    await prisma.user.delete({ where: { id: autre.id } })
  })
})
