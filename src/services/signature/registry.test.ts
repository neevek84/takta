import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import type { SignatureFetchLike } from '@/core/signature/connector'
import { saveInstanceCredential } from '@/services/credentials'
import { PROVIDER_DOCUMENSO } from './constants'
import { getSignatureConnector } from './registry'

const initial = {
  url: process.env.DOCUMENSO_URL,
  cle: process.env.DOCUMENSO_API_KEY,
  chiffrement: process.env.CREDENTIALS_KEY,
}

beforeEach(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
  await prisma.providerCredential.deleteMany({})
})

afterEach(async () => {
  await prisma.providerCredential.deleteMany({})
  if (initial.chiffrement === undefined) delete process.env.CREDENTIALS_KEY
  else process.env.CREDENTIALS_KEY = initial.chiffrement
  if (initial.url === undefined) delete process.env.DOCUMENSO_URL
  else process.env.DOCUMENSO_URL = initial.url
  if (initial.cle === undefined) delete process.env.DOCUMENSO_API_KEY
  else process.env.DOCUMENSO_API_KEY = initial.cle
})

describe('getSignatureConnector', () => {
  it('rend null sans configuration — l instance reste utilisable', async () => {
    delete process.env.DOCUMENSO_URL
    delete process.env.DOCUMENSO_API_KEY
    expect(await getSignatureConnector()).toBeNull()
  })

  it('rend null quand une seule des deux valeurs est posée', async () => {
    process.env.DOCUMENSO_URL = 'https://documenso.test'
    delete process.env.DOCUMENSO_API_KEY
    expect(await getSignatureConnector()).toBeNull()

    delete process.env.DOCUMENSO_URL
    process.env.DOCUMENSO_API_KEY = 'api_cle'
    expect(await getSignatureConnector()).toBeNull()
  })

  it('rend le connecteur Documenso quand tout est posé', async () => {
    process.env.DOCUMENSO_URL = 'https://documenso.test'
    process.env.DOCUMENSO_API_KEY = 'api_cle'
    const connecteur = await getSignatureConnector()
    expect(connecteur?.provider).toBe('documenso')
  })

  it('ne touche pas au réseau à la simple résolution du connecteur', async () => {
    process.env.DOCUMENSO_URL = 'https://documenso.test'
    process.env.DOCUMENSO_API_KEY = 'api_cle'
    await expect(getSignatureConnector()).resolves.not.toBeNull()
  })

  it('le réglage de l écran l emporte sur les variables d environnement', async () => {
    process.env.DOCUMENSO_URL = 'https://env.documenso.test'
    process.env.DOCUMENSO_API_KEY = 'api_cle_env'
    await saveInstanceCredential({
      provider: PROVIDER_DOCUMENSO,
      secret: 'api_cle_ecran',
      baseUrl: 'https://ecran.documenso.test',
    })

    const connecteur = await getSignatureConnector()
    // L'URL embarquée est la seule sortie du connecteur qui ne touche pas au
    // réseau : elle dit sur quelle instance il pointe.
    expect(connecteur?.urlEmbarquee('j', { nom: 'N', email: 'n@x.test' })).toMatch(
      /^https:\/\/ecran\.documenso\.test\/embed\/sign\/j#/,
    )
  })

  it('le réglage de l écran suffit, sans aucune variable', async () => {
    delete process.env.DOCUMENSO_URL
    delete process.env.DOCUMENSO_API_KEY
    await saveInstanceCredential({
      provider: PROVIDER_DOCUMENSO,
      secret: 'api_cle_ecran',
      baseUrl: 'https://ecran.documenso.test',
    })
    expect((await getSignatureConnector())?.provider).toBe('documenso')
  })

  it('la clé de l écran est celle qui part au prestataire', async () => {
    await saveInstanceCredential({
      provider: PROVIDER_DOCUMENSO,
      secret: 'api_cle_ecran',
      baseUrl: 'https://ecran.documenso.test',
    })
    const recues: string[] = []
    const fetchFn: SignatureFetchLike = async (_url, init) => {
      recues.push(init.headers.Authorization ?? '')
      return new Response('{}', { status: 200 })
    }
    const connecteur = await getSignatureConnector({ fetchFn })
    await connecteur?.status('envelope_x')
    expect(recues).toEqual(['api_cle_ecran'])
  })
})
