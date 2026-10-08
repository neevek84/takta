import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import type { SignatureFetchLike } from '@/core/signature/connector'
import { readAuditSince, currentAuditSeq } from '@/services/audit'
import {
  PROVIDER_DOCUMENSO_WEBHOOK,
  enregistrerConnexionDocumenso,
  genererSecretWebhook,
  lireConfigurationDocumenso,
  lireSecretWebhook,
  origineDocumensoEnVigueur,
  retirerConnexionDocumenso,
  testerConfigurationSignature,
  vueReglagesSignature,
} from './reglages'
import { PROVIDER_DOCUMENSO } from './constants'

/** Aucune vraie clé, aucune vraie instance : ces chaînes n'ouvrent rien. */
const CLE_ECRAN = 'api_cle_ecran_0000000000'
const CLE_ENV = 'api_cle_env_00000000000'

const ENV = ['DOCUMENSO_URL', 'DOCUMENSO_API_KEY', 'SIGNATURE_WEBHOOK_SECRET', 'CREDENTIALS_KEY'] as const
const initial = Object.fromEntries(ENV.map((n) => [n, process.env[n]]))

let userId = ''

beforeAll(async () => {
  const u = await prisma.user.create({
    data: {
      email: 'reglages-signature@test.local',
      name: 'Admin Signature',
      passwordHash: 'x',
    },
  })
  userId = u.id
})

beforeEach(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
  delete process.env.DOCUMENSO_URL
  delete process.env.DOCUMENSO_API_KEY
  delete process.env.SIGNATURE_WEBHOOK_SECRET
  await prisma.providerCredential.deleteMany({})
})

afterAll(async () => {
  for (const n of ENV) {
    if (initial[n] === undefined) delete process.env[n]
    else process.env[n] = initial[n]
  }
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: 'reglages-signature@test.local' },
  })
})

describe('la configuration en vigueur : écran > environnement', () => {
  it('rien de posé : aucune configuration', async () => {
    expect(await lireConfigurationDocumenso()).toEqual({
      provenance: 'aucune',
      baseUrl: '',
      apiKey: '',
    })
    expect(await origineDocumensoEnVigueur()).toBe('')
  })

  it('les variables d environnement restent un repli', async () => {
    process.env.DOCUMENSO_URL = 'https://env.documenso.test/'
    process.env.DOCUMENSO_API_KEY = CLE_ENV
    expect(await lireConfigurationDocumenso()).toEqual({
      provenance: 'env',
      baseUrl: 'https://env.documenso.test/',
      apiKey: CLE_ENV,
    })
    expect(await origineDocumensoEnVigueur()).toBe('https://env.documenso.test')
  })

  it('une seule des deux variables ne configure rien', async () => {
    process.env.DOCUMENSO_URL = 'https://env.documenso.test'
    expect((await lireConfigurationDocumenso()).provenance).toBe('aucune')
  })

  it('le réglage de l écran l emporte sur l environnement', async () => {
    process.env.DOCUMENSO_URL = 'https://env.documenso.test'
    process.env.DOCUMENSO_API_KEY = CLE_ENV
    const r = await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://sign.exemple.test/',
      apiKey: CLE_ECRAN,
    })
    expect(r.ok).toBe(true)

    expect(await lireConfigurationDocumenso()).toEqual({
      provenance: 'ecran',
      baseUrl: 'https://sign.exemple.test',
      apiKey: CLE_ECRAN,
    })
    expect(await origineDocumensoEnVigueur()).toBe('https://sign.exemple.test')
  })

  it('retirer le réglage de l écran rend la main à l environnement', async () => {
    process.env.DOCUMENSO_URL = 'https://env.documenso.test'
    process.env.DOCUMENSO_API_KEY = CLE_ENV
    await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://sign.exemple.test',
      apiKey: CLE_ECRAN,
    })
    await retirerConnexionDocumenso({ userId })

    expect((await lireConfigurationDocumenso()).provenance).toBe('env')
  })
})

describe('enregistrerConnexionDocumenso', () => {
  it('refuse une URL qui porte des identifiants', async () => {
    for (const baseUrl of ['https://admin:mdp@sign.exemple.test', 'https://jeton@sign.exemple.test']) {
      const r = await enregistrerConnexionDocumenso({
        userId,
        baseUrl,
        apiKey: CLE_ECRAN,
      })
      expect(r).toEqual({
        ok: false,
        erreurs: [
          "L'adresse ne doit pas contenir d'identifiants ; la clé d'API se saisit dans son propre champ.",
        ],
      })
    }
    expect(await prisma.providerCredential.count()).toBe(0)
  })

  it('chiffre la clé au repos', async () => {
    await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://sign.exemple.test',
      apiKey: CLE_ECRAN,
    })
    const row = await prisma.providerCredential.findFirstOrThrow({
      where: { provider: PROVIDER_DOCUMENSO },
    })
    expect(row.accessTokenEnc).not.toContain(CLE_ECRAN)
    expect(row.baseUrl).toBe('https://sign.exemple.test')
  })

  it('une clé laissée vide conserve la clé enregistrée', async () => {
    await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://sign.exemple.test',
      apiKey: CLE_ECRAN,
    })
    const r = await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://autre.exemple.test',
      apiKey: '',
    })
    expect(r.ok).toBe(true)
    expect(await lireConfigurationDocumenso()).toEqual({
      provenance: 'ecran',
      baseUrl: 'https://autre.exemple.test',
      apiKey: CLE_ECRAN,
    })
  })

  it('refuse une clé vide quand aucune n est enregistrée', async () => {
    const r = await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://sign.exemple.test',
      apiKey: '',
    })
    expect(r).toEqual({ ok: false, erreurs: ["La clé d'API est requise."] })
    expect(await prisma.providerCredential.count()).toBe(0)
  })

  it('refuse une adresse illisible ou hors http(s)', async () => {
    for (const baseUrl of ['', 'pas une url', 'ftp://sign.exemple.test']) {
      const r = await enregistrerConnexionDocumenso({
        userId,
        baseUrl,
        apiKey: CLE_ECRAN,
      })
      expect(r.ok).toBe(false)
    }
    expect(await prisma.providerCredential.count()).toBe(0)
  })

  it('consigne le changement, sans la clé', async () => {
    const avant = await currentAuditSeq()
    await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://sign.exemple.test',
      apiKey: CLE_ECRAN,
    })
    await retirerConnexionDocumenso({ userId })

    const journal = await readAuditSince({ since: avant })
    expect(journal.map((e) => e.action)).toEqual(['reglage.modifie', 'reglage.modifie'])
    expect(journal[0]).toMatchObject({
      actorId: userId,
      entityType: 'Settings',
      entityId: 'signature',
    })
    expect(journal[0]!.payload).toMatchObject({
      documensoUrl: 'https://sign.exemple.test',
    })
    expect(journal[1]!.payload).toMatchObject({ documensoUrl: '' })
    expect(JSON.stringify(journal)).not.toContain(CLE_ECRAN)
  })
})

describe('le secret du webhook', () => {
  it('généré par l outil : 32 octets en hexadécimal, rendu une fois, chiffré au repos', async () => {
    const secret = await genererSecretWebhook({ userId })
    expect(secret).toMatch(/^[0-9a-f]{64}$/)

    const row = await prisma.providerCredential.findFirstOrThrow({
      where: { provider: PROVIDER_DOCUMENSO_WEBHOOK },
    })
    expect(row.accessTokenEnc).not.toContain(secret)
    expect(await lireSecretWebhook()).toBe(secret)
  })

  it('régénérer remplace l ancien secret', async () => {
    const premier = await genererSecretWebhook({ userId })
    const second = await genererSecretWebhook({ userId })
    expect(second).not.toBe(premier)
    expect(await lireSecretWebhook()).toBe(second)
  })

  it('le secret de l écran l emporte sur SIGNATURE_WEBHOOK_SECRET, qui reste un repli', async () => {
    process.env.SIGNATURE_WEBHOOK_SECRET = 'secret-env-de-repli'
    expect(await lireSecretWebhook()).toBe('secret-env-de-repli')

    const secret = await genererSecretWebhook({ userId })
    expect(await lireSecretWebhook()).toBe(secret)
  })

  it('aucun secret nulle part : chaîne vide, le webhook refuse tout', async () => {
    expect(await lireSecretWebhook()).toBe('')
  })

  it('consigne la génération, sans le secret', async () => {
    const avant = await currentAuditSeq()
    const secret = await genererSecretWebhook({ userId })
    const journal = await readAuditSince({ since: avant })
    expect(journal).toHaveLength(1)
    expect(journal[0]).toMatchObject({
      action: 'reglage.modifie',
      entityId: 'signature',
    })
    expect(JSON.stringify(journal)).not.toContain(secret)
  })
})

describe('vueReglagesSignature', () => {
  it('dit d où vient la configuration, sans aucun secret', async () => {
    expect(await vueReglagesSignature()).toEqual({
      connexion: {
        provenance: 'aucune',
        baseUrl: '',
        enregistreLe: null,
        ligne: false,
        illisible: false,
      },
      webhook: { provenance: 'aucune', genereLe: null, illisible: false },
    })

    process.env.DOCUMENSO_URL = 'https://env.documenso.test'
    process.env.DOCUMENSO_API_KEY = CLE_ENV
    process.env.SIGNATURE_WEBHOOK_SECRET = 'secret-env-de-repli'
    const env = await vueReglagesSignature()
    expect(env.connexion).toMatchObject({
      provenance: 'env',
      baseUrl: 'https://env.documenso.test',
    })
    expect(env.webhook.provenance).toBe('env')

    await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://sign.exemple.test',
      apiKey: CLE_ECRAN,
    })
    const secret = await genererSecretWebhook({ userId })
    const ecran = await vueReglagesSignature()
    expect(ecran.connexion.provenance).toBe('ecran')
    expect(ecran.connexion.enregistreLe).toBeInstanceOf(Date)
    expect(ecran.webhook.provenance).toBe('ecran')
    expect(ecran.webhook.genereLe).toBeInstanceOf(Date)

    const texte = JSON.stringify(ecran)
    for (const s of [CLE_ECRAN, CLE_ENV, secret, 'secret-env-de-repli']) expect(texte).not.toContain(s)
  })
})

describe('réglages devenus illisibles (CREDENTIALS_KEY changée)', () => {
  it('la vue le dit, garde la ligne, et l environnement reprend la main', async () => {
    await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://sign.exemple.test',
      apiKey: CLE_ECRAN,
    })
    await genererSecretWebhook({ userId })
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

    const vue = await vueReglagesSignature()
    expect(vue.connexion).toMatchObject({
      provenance: 'aucune',
      ligne: true,
      illisible: true,
    })
    expect(vue.webhook).toMatchObject({
      provenance: 'aucune',
      illisible: true,
    })
  })

  it('une ligne lisible n est pas illisible', async () => {
    await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://sign.exemple.test',
      apiKey: CLE_ECRAN,
    })
    const vue = await vueReglagesSignature()
    expect(vue.connexion).toMatchObject({ ligne: true, illisible: false })
    expect(vue.webhook.illisible).toBe(false)
  })
})

describe('testerConfigurationSignature', () => {
  const repond: SignatureFetchLike = async () =>
    new Response('{"data":[]}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  it('sans configuration, ne touche pas au réseau et le dit', async () => {
    let appels = 0
    const r = await testerConfigurationSignature({
      fetchFn: async (...a) => {
        appels += 1
        return repond(...a)
      },
      smtpConfigure: async () => true,
    })
    expect(appels).toBe(0)
    expect(r.ok).toBe(false)
    expect(r.verifications[0]!.texte).toMatch(/Aucune configuration/)
  })

  it('teste la configuration en vigueur, et lit SMTP', async () => {
    await enregistrerConnexionDocumenso({
      userId,
      baseUrl: 'https://sign.exemple.test',
      apiKey: CLE_ECRAN,
    })
    const urls: string[] = []
    const r = await testerConfigurationSignature({
      fetchFn: async (url, init) => {
        urls.push(url)
        expect(init.headers.Authorization).toBe(CLE_ECRAN)
        return repond(url, init)
      },
      smtpConfigure: async () => false,
    })
    expect(urls).toEqual(['https://sign.exemple.test/api/v2/document?page=1&perPage=1'])
    expect(r.ok).toBe(false)
    expect(r.verifications.find((v) => v.cle === 'smtp')?.etat).toBe('echec')
    expect(r.verifications.find((v) => v.cle === 'cle')?.etat).toBe('ok')
  })
})
