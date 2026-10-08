import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  requireUser,
  revalidatePath,
  enregistrerConnexionDocumenso,
  retirerConnexionDocumenso,
  genererSecretWebhook,
  testerConfigurationSignature,
  vueReglagesSignature,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  enregistrerConnexionDocumenso: vi.fn(),
  retirerConnexionDocumenso: vi.fn(),
  genererSecretWebhook: vi.fn(),
  testerConfigurationSignature: vi.fn(),
  vueReglagesSignature: vi.fn(),
}))

vi.mock('@/auth', () => ({
  requireUser,
  // La vraie règle, importée et non recopiée : un double qui laisserait passer
  // un consultant ferait passer au vert une action sans garde.
  exigerAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer, MOTIF_REFUS_ADMIN } = await import('@/core/auth/roles')
    if (!peutAdministrer(u.role)) throw new Error(MOTIF_REFUS_ADMIN)
    return u
  },
}))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/signature/reglages', () => ({
  enregistrerConnexionDocumenso,
  retirerConnexionDocumenso,
  genererSecretWebhook,
  testerConfigurationSignature,
  vueReglagesSignature,
}))

import {
  enregistrerSignature,
  deconnecterSignature,
  genererSecret,
  testerSignature,
} from './actions'

const CLE_FICTIVE = 'cle-api-de-test-0000'
const SECRET_FICTIF = 'f'.repeat(64)

function form(champs: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(champs)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  revalidatePath.mockReset()
  enregistrerConnexionDocumenso.mockReset().mockResolvedValue({ ok: true })
  retirerConnexionDocumenso.mockReset().mockResolvedValue(undefined)
  genererSecretWebhook.mockReset().mockResolvedValue(SECRET_FICTIF)
  testerConfigurationSignature.mockReset().mockResolvedValue({ ok: true, verifications: [] })
  vueReglagesSignature.mockReset().mockResolvedValue({
    connexion: { provenance: 'ecran', baseUrl: 'https://sign.invalid', enregistreLe: new Date() },
    webhook: { provenance: 'aucune', genereLe: null },
  })
})

const ACTIONS: Array<[string, () => Promise<unknown>]> = [
  ['enregistrerSignature', () => enregistrerSignature(null, form({ baseUrl: 'https://sign.invalid', apiKey: CLE_FICTIVE }))],
  ['deconnecterSignature', () => deconnecterSignature()],
  ['genererSecret', () => genererSecret(null, form({ confirmer: 'oui' }))],
  ['testerSignature', () => testerSignature(null)],
]

describe('chaque action exige le rôle d administration', () => {
  it.each(ACTIONS)('%s refuse un consultant, sans rien toucher', async (_nom, appel) => {
    requireUser.mockResolvedValue({ id: 'u2', role: 'CONSULTANT' })
    await expect(appel()).rejects.toThrow()

    expect(enregistrerConnexionDocumenso).not.toHaveBeenCalled()
    expect(retirerConnexionDocumenso).not.toHaveBeenCalled()
    expect(genererSecretWebhook).not.toHaveBeenCalled()
    expect(testerConfigurationSignature).not.toHaveBeenCalled()
  })

  it.each(ACTIONS)('%s refuse sans session', async (_nom, appel) => {
    requireUser.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(appel()).rejects.toThrow()
    expect(enregistrerConnexionDocumenso).not.toHaveBeenCalled()
    expect(genererSecretWebhook).not.toHaveBeenCalled()
  })
})

describe('enregistrerSignature', () => {
  it('transmet l URL et la clé au service, au nom de la session', async () => {
    const r = await enregistrerSignature(null, form({ baseUrl: ' https://sign.invalid ', apiKey: ` ${CLE_FICTIVE} ` }))

    expect(enregistrerConnexionDocumenso).toHaveBeenCalledWith({
      userId: 'u1',
      baseUrl: 'https://sign.invalid',
      apiKey: CLE_FICTIVE,
    })
    expect(r).toMatchObject({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/signature')
  })

  it('rend les refus du service', async () => {
    enregistrerConnexionDocumenso.mockResolvedValue({ ok: false, erreurs: ["La clé d'API est requise."] })
    const r = await enregistrerSignature(null, form({ baseUrl: 'https://sign.invalid', apiKey: '' }))
    expect(r).toEqual({ ok: false, erreurs: ["La clé d'API est requise."] })
  })

  it('expurge la clé saisie d un message d erreur', async () => {
    enregistrerConnexionDocumenso.mockRejectedValue(new Error(`échec avec ${CLE_FICTIVE}`))
    const r = await enregistrerSignature(null, form({ baseUrl: 'https://sign.invalid', apiKey: CLE_FICTIVE }))
    expect(r).toMatchObject({ ok: false })
    expect(JSON.stringify(r)).not.toContain(CLE_FICTIVE)
  })
})

describe('deconnecterSignature', () => {
  it('retire l identifiant au nom de la session', async () => {
    await deconnecterSignature()
    expect(retirerConnexionDocumenso).toHaveBeenCalledWith({ userId: 'u1' })
    expect(revalidatePath).toHaveBeenCalledWith('/admin/signature')
  })
})

describe('genererSecret', () => {
  it('rend le secret une fois, pour qu il soit collé dans Documenso', async () => {
    const r = await genererSecret(null, form({}))
    expect(genererSecretWebhook).toHaveBeenCalledWith({ userId: 'u1' })
    expect(r).toEqual({ ok: true, secret: SECRET_FICTIF })
  })

  it('refuse de régénérer un secret déjà posé à l écran sans confirmation', async () => {
    vueReglagesSignature.mockResolvedValue({
      connexion: { provenance: 'aucune', baseUrl: '', enregistreLe: null },
      webhook: { provenance: 'ecran', genereLe: new Date() },
    })
    const r = await genererSecret(null, form({}))
    expect(r).toMatchObject({ ok: false })
    expect(genererSecretWebhook).not.toHaveBeenCalled()

    const confirme = await genererSecret(null, form({ confirmer: 'oui' }))
    expect(confirme).toEqual({ ok: true, secret: SECRET_FICTIF })
  })
})

describe('testerSignature', () => {
  it('rend les vérifications du service, telles quelles', async () => {
    const verifs = {
      ok: false,
      verifications: [{ cle: 'instance', etat: 'echec', texte: 'L’instance ne répond pas.' }],
    }
    testerConfigurationSignature.mockResolvedValue(verifs)
    expect(await testerSignature(null)).toEqual(verifs)
  })
})
