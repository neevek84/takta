import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { genererSecretWebhook } from './reglages'
import { handleSignatureWebhook } from './webhook'

/**
 * Quel secret le webhook compare-t-il quand la route ne lui en passe aucun —
 * c'est-à-dire en production ?
 *
 * Une enveloppe inconnue suffit : `LIEN_INCONNU` prouve que l'authentification
 * est passée, `SIGNATURE_INVALIDE` qu'elle a échoué. Rien n'est appliqué.
 */
const CHARGE = JSON.stringify({ event: 'DOCUMENT_COMPLETED', payload: { envelopeId: 'envelope_inconnue' } })
const SECRET_ENV = 'secret-env-de-repli-0000'

const initial = { cle: process.env.CREDENTIALS_KEY, env: process.env.SIGNATURE_WEBHOOK_SECRET }
let userId = ''

const recevoir = (secretHeader: string) =>
  handleSignatureWebhook({ rawBody: CHARGE, secretHeader, signatureHeader: '', connector: null })

beforeAll(async () => {
  const u = await prisma.user.create({
    data: { email: 'webhook-secret@test.local', name: 'W', passwordHash: 'x' },
  })
  userId = u.id
})

beforeEach(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
  delete process.env.SIGNATURE_WEBHOOK_SECRET
  await prisma.providerCredential.deleteMany({})
})

afterAll(async () => {
  if (initial.cle === undefined) delete process.env.CREDENTIALS_KEY
  else process.env.CREDENTIALS_KEY = initial.cle
  if (initial.env === undefined) delete process.env.SIGNATURE_WEBHOOK_SECRET
  else process.env.SIGNATURE_WEBHOOK_SECRET = initial.env
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'webhook-secret@test.local' } })
})

describe('le secret que lit le webhook', () => {
  it('accepte le secret généré à l écran', async () => {
    const secret = await genererSecretWebhook({ userId })
    expect(await recevoir(secret)).toEqual({ ok: false, raison: 'LIEN_INCONNU' })
  })

  it('le secret de l écran l emporte : celui de l environnement ne passe plus', async () => {
    process.env.SIGNATURE_WEBHOOK_SECRET = SECRET_ENV
    await genererSecretWebhook({ userId })
    expect(await recevoir(SECRET_ENV)).toEqual({ ok: false, raison: 'SIGNATURE_INVALIDE' })
  })

  it('sans secret à l écran, SIGNATURE_WEBHOOK_SECRET reste le repli', async () => {
    process.env.SIGNATURE_WEBHOOK_SECRET = SECRET_ENV
    expect(await recevoir(SECRET_ENV)).toEqual({ ok: false, raison: 'LIEN_INCONNU' })
  })

  it('sans secret nulle part, tout est refusé', async () => {
    expect(await recevoir('')).toEqual({ ok: false, raison: 'SIGNATURE_INVALIDE' })
  })
})
