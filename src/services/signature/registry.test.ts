import { describe, it, expect, afterEach } from 'vitest'
import { getSignatureConnector } from './registry'

const initial = { url: process.env.DOCUMENSO_URL, cle: process.env.DOCUMENSO_API_KEY }

afterEach(() => {
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
})
