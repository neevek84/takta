import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { prisma } from '@/db/client'
import { createClient } from '@/services/clients'
import { createMission, createLine } from '@/services/missions'
import { saveEntry } from '@/services/time-entries'
import { getOrCreateCra, transitionCra } from '@/services/cra'
import { updateSettings } from '@/services/settings'
import type { Mailer } from '@/services/notify'
import { createFakeSignatureConnector, type FakeSignatureConnector } from './fake-connector'
import { sendCraForSignature } from './send'
import {
  confirmerDepuisPage,
  demanderCode,
  lireVueClient,
  nouveauLienManuel,
  pdfSigneDuLien,
  resoudreLien,
  verifierCode,
} from './lien-client'

process.env.AUTH_SECRET ??= 'secret-de-test-lien-client'

const ORIGINE = 'https://cra.test'
let userId = ''
let missionId = ''
let lineId = ''
let craId = ''
let connector: FakeSignatureConnector
let corps: string[] = []
const mailer: Mailer = async (m) => {
  corps.push(m.corps)
}

function jetonDuDernierCourriel(): string {
  const m = /\/v\/([0-9a-f]{64})/.exec(corps.filter((c) => c.includes('/v/')).at(-1) ?? '')
  return m![1]!
}
function codeDuDernierCourriel(): string {
  const m = /Votre code : (\d{6})/.exec(corps.filter((c) => c.includes('Votre code')).at(-1) ?? '')
  return m![1]!
}

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: 'lien@test.local', name: 'T', passwordHash: 'x' } })).id
  const c = await createClient('LIEN client')
  missionId = (await createMission({ clientId: c.id, label: 'ITSM', signataireNom: 'Jeanne Martin', signataireEmail: 'jeanne@client.test' })).id
  lineId = (await createLine({ missionId, userId, label: 'Jour', soldCentiemes: 3000, tjmCents: 80000 })).id
})

beforeEach(async () => {
  await prisma.lienClient.deleteMany({})
  await prisma.signatureEnvoiClos.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { userId } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await updateSettings({ minutesParJour: 480, capacityMode: 'DESACTIVE' })
  corps = []
  connector = createFakeSignatureConnector()
  craId = (await getOrCreateCra(userId, missionId, '2026-09')).id
  await saveEntry({ userId, lineId, date: '2026-09-01', minutes: 480, kind: 'REALISE' })
  await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
})

afterAll(async () => {
  await prisma.lienClient.deleteMany({})
  await prisma.signatureEnvoiClos.deleteMany({})
  await prisma.externalLink.deleteMany({ where: { userId } })
  await prisma.signatureRequest.deleteMany({})
  await prisma.timeEntry.deleteMany({ where: { userId } })
  await prisma.cra.deleteMany({ where: { userId } })
  await prisma.user.deleteMany({ where: { email: 'lien@test.local' } })
  await prisma.client.deleteMany({ where: { name: 'LIEN client' } })
  await prisma.settings.deleteMany({})
  await prisma.$disconnect()
})

const T0 = new Date('2026-10-07T10:00:00Z')
const plus = (min: number) => new Date(T0.getTime() + min * 60_000)

async function ouvrir(): Promise<string> {
  const jeton = jetonDuDernierCourriel()
  await demanderCode(jeton, { maintenant: T0, mailer })
  const r = await verifierCode(jeton, codeDuDernierCourriel(), { maintenant: plus(1) })
  if (!r.ok) throw new Error('ouverture impossible')
  return r.lienId
}

describe('resoudreLien', () => {
  it('reconnaît le lien envoyé', async () => {
    expect((await resoudreLien(jetonDuDernierCourriel())).etat).toBe('ACTIF')
  })

  it('INCONNU pour un jeton mal formé ou absent — sans lever', async () => {
    for (const j of ['', 'abc', 'z'.repeat(64), '0'.repeat(64)]) {
      expect(await resoudreLien(j)).toEqual({ etat: 'INCONNU', lienId: null })
    }
  })

  it('REMPLACE après un renvoi', async () => {
    const ancien = jetonDuDernierCourriel()
    await transitionCra(userId, craId, 'REFUSER')
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect((await resoudreLien(ancien)).etat).toBe('REMPLACE')
    expect((await resoudreLien(jetonDuDernierCourriel())).etat).toBe('ACTIF')
  })

  it("lien d'un envoi clos signé puis rouvert et renvoyé : REMPLACE, jamais le PDF de l'ancien envoi", async () => {
    const ancien = jetonDuDernierCourriel()
    connector.regler('ext-1', 'SIGNE')
    const lienId = await ouvrir()
    await confirmerDepuisPage(lienId, { connector })
    await transitionCra(userId, craId, 'ROUVRIR')
    await sendCraForSignature(userId, craId, { connector, origine: ORIGINE, mailer })
    expect((await resoudreLien(ancien)).etat).toBe('REMPLACE')
    expect(await pdfSigneDuLien(lienId)).toBeNull()
  })
})

describe('demanderCode et verifierCode', () => {
  it('envoie un code à six chiffres au signataire figé, et rend son adresse masquée', async () => {
    const r = await demanderCode(jetonDuDernierCourriel(), { maintenant: T0, mailer })
    expect(r).toEqual({ ok: true, adresseMasquee: 'j•••@client.test' })
    expect(codeDuDernierCourriel()).toMatch(/^\d{6}$/)
  })

  it('le code juste ouvre, une seule fois', async () => {
    const jeton = jetonDuDernierCourriel()
    await demanderCode(jeton, { maintenant: T0, mailer })
    const code = codeDuDernierCourriel()
    expect((await verifierCode(jeton, code, { maintenant: plus(1) })).ok).toBe(true)
    expect(await verifierCode(jeton, code, { maintenant: plus(2) })).toEqual({ ok: false, raison: 'CODE' })
  })

  it('un code expiré à dix minutes', async () => {
    const jeton = jetonDuDernierCourriel()
    await demanderCode(jeton, { maintenant: T0, mailer })
    expect(await verifierCode(jeton, codeDuDernierCourriel(), { maintenant: plus(10) })).toEqual({ ok: false, raison: 'CODE' })
  })

  it('cinq essais faux épuisent le code — même le bon ne passe plus', async () => {
    const jeton = jetonDuDernierCourriel()
    await demanderCode(jeton, { maintenant: T0, mailer })
    const bon = codeDuDernierCourriel()
    const faux = bon === '000000' ? '111111' : '000000'
    const resultats = []
    for (let i = 0; i < 5; i += 1) resultats.push((await verifierCode(jeton, faux, { maintenant: plus(1) })) as { raison: string })
    expect(resultats.map((r) => r.raison)).toEqual(['CODE', 'CODE', 'CODE', 'CODE', 'EPUISE'])
    expect(await verifierCode(jeton, bon, { maintenant: plus(1) })).toEqual({ ok: false, raison: 'EPUISE' })
  })

  it('demander deux codes : seul le dernier vaut', async () => {
    const jeton = jetonDuDernierCourriel()
    await demanderCode(jeton, { maintenant: T0, mailer })
    const premier = codeDuDernierCourriel()
    await demanderCode(jeton, { maintenant: plus(1), mailer })
    const second = codeDuDernierCourriel()
    if (premier !== second) {
      expect(await verifierCode(jeton, premier, { maintenant: plus(2) })).toEqual({ ok: false, raison: 'CODE' })
    }
    expect((await verifierCode(jeton, second, { maintenant: plus(2) })).ok).toBe(true)
  })

  it('cinq codes par heure, pas un de plus ; la fenêtre se rouvre', async () => {
    const jeton = jetonDuDernierCourriel()
    for (let i = 0; i < 5; i += 1) expect((await demanderCode(jeton, { maintenant: plus(i), mailer })).ok).toBe(true)
    expect(await demanderCode(jeton, { maintenant: plus(6), mailer })).toEqual({ ok: false, raison: 'TROP_DE_CODES' })
    expect((await demanderCode(jeton, { maintenant: plus(61), mailer })).ok).toBe(true)
  })

  it('refuse un lien inconnu, révoqué ou remplacé, sans envoyer de courriel', async () => {
    const avant = corps.length
    expect(await demanderCode('0'.repeat(64), { maintenant: T0, mailer })).toEqual({ ok: false, raison: 'LIEN' })
    expect(corps.length).toBe(avant)
  })

  it('le journal ne contient ni le code, ni l adresse', async () => {
    const jeton = jetonDuDernierCourriel()
    await demanderCode(jeton, { maintenant: T0, mailer })
    const code = codeDuDernierCourriel()
    await verifierCode(jeton, '999999' === code ? '888888' : '999999', { maintenant: plus(1) })
    await verifierCode(jeton, code, { maintenant: plus(1) })
    const tout = (await prisma.auditEvent.findMany({ where: { entityId: craId } })).map((e) => `${e.action} ${e.payloadJson}`).join('\n')
    expect(tout).toContain('signature.code.envoye')
    expect(tout).toContain('signature.code.echoue')
    expect(tout).toContain('signature.code.valide')
    expect(tout).not.toContain(code)
    expect(tout).not.toContain('jeanne')
  })
})

describe('lireVueClient', () => {
  it('rend le contenu FIGÉ, même après réouverture et modification du CRA', async () => {
    const lienId = await ouvrir()
    // Un changement de réglage de conversion ne doit rien changer à ce que
    // voit le client : la vue ne lit que le contenu figé.
    const avant = await lireVueClient(lienId, { connector, maintenant: plus(2) })
    expect(avant.etat).toBe('ACTIF')
    expect(avant.document!.totalCentiemes).toBe(100)
    expect(avant.statut).toBe('A_SIGNER')
    expect(avant.urlEmbarquee).toBe('https://signature.double/embed/sign/jeton-1')

    await updateSettings({ minutesParJour: 420, capacityMode: 'DESACTIVE' })
    const apres = await lireVueClient(lienId, { connector, maintenant: plus(3) })
    expect(apres.document).toEqual(avant.document)
  })

  it("ne porte aucun montant", async () => {
    const lienId = await ouvrir()
    const vue = await lireVueClient(lienId, { connector, maintenant: plus(2) })
    expect(JSON.stringify(vue)).not.toMatch(/tjm|Cents|80000/i)
  })

  it('après signature : statut SIGNE, date, PDF signé disponible, plus de cadre', async () => {
    connector.regler('ext-1', 'SIGNE')
    const lienId = await ouvrir()
    await confirmerDepuisPage(lienId, { connector })
    const vue = await lireVueClient(lienId, { connector, maintenant: plus(3) })
    expect(vue.statut).toBe('SIGNE')
    expect(vue.signeLe).not.toBeNull()
    expect(vue.pdfSigneDisponible).toBe(true)
    expect(vue.urlEmbarquee).toBeNull()
    expect((await pdfSigneDuLien(lienId))!.bytes.byteLength).toBeGreaterThan(0)
  })

  it('après refus : statut REFUSE et motif', async () => {
    connector.regler('ext-1', 'REFUSE', 'Il manque le 15.')
    const lienId = await ouvrir()
    await confirmerDepuisPage(lienId, { connector })
    const vue = await lireVueClient(lienId, { connector, maintenant: plus(3) })
    expect(vue).toMatchObject({ statut: 'REFUSE', motifRefus: 'Il manque le 15.' })
  })

  it('journalise la consultation, au plus une fois par heure', async () => {
    const lienId = await ouvrir()
    await lireVueClient(lienId, { connector, maintenant: plus(2) })
    await lireVueClient(lienId, { connector, maintenant: plus(30) })
    await lireVueClient(lienId, { connector, maintenant: plus(90) })
    expect(await prisma.auditEvent.count({ where: { entityId: craId, action: 'signature.lien.ouvert' } })).toBe(2)
  })
})

describe('confirmerDepuisPage', () => {
  it("n'applique que ce que le prestataire confirme", async () => {
    const lienId = await ouvrir()
    await confirmerDepuisPage(lienId, { connector })
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('ENVOYE')
    connector.regler('ext-1', 'SIGNE')
    await confirmerDepuisPage(lienId, { connector })
    expect((await prisma.cra.findUniqueOrThrow({ where: { id: craId } })).status).toBe('VALIDE')
  })
})

describe('nouveauLienManuel', () => {
  it('rend une URL neuve pour l envoi en cours, sans révoquer les autres', async () => {
    const ancien = jetonDuDernierCourriel()
    const r = await nouveauLienManuel(userId, craId, ORIGINE)
    expect(r.ok).toBe(true)
    expect((r as { url: string }).url).toMatch(/^https:\/\/cra\.test\/v\/[0-9a-f]{64}$/)
    expect((await resoudreLien(ancien)).etat).toBe('ACTIF')
  })

  it("refuse quand aucun lien ouvert ne porte de jeton prestataire", async () => {
    await prisma.lienClient.updateMany({ where: { craId }, data: { revokedAt: new Date() } })
    expect(await nouveauLienManuel(userId, craId, ORIGINE)).toEqual({ ok: false })
    expect(await prisma.lienClient.count({ where: { craId, revokedAt: null } })).toBe(0)
  })

  it("refuse le CRA d'un autre, et un CRA qui n'est pas en attente", async () => {
    expect(await nouveauLienManuel('autre', craId, ORIGINE)).toEqual({ ok: false })
    connector.regler('ext-1', 'SIGNE')
    const lienId = await ouvrir()
    await confirmerDepuisPage(lienId, { connector })
    expect(await nouveauLienManuel(userId, craId, ORIGINE)).toEqual({ ok: false })
  })
})
