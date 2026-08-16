import { describe, it, expect, afterEach } from 'vitest'
import { requireApiToken } from './api-token'

const ORIGINAL = process.env.CRA_API_TOKEN

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRA_API_TOKEN
  else process.env.CRA_API_TOKEN = ORIGINAL
})

function requete(entete?: string): Request {
  return new Request('https://exemple.test/api/events', {
    headers: entete === undefined ? {} : { authorization: entete },
  })
}

describe('garde de jeton d API', () => {
  it('accepte le jeton attendu', () => {
    process.env.CRA_API_TOKEN = 'jeton-de-test'
    expect(requireApiToken(requete('Bearer jeton-de-test'))).toEqual({ ok: true })
  })

  it('refuse un jeton faux', async () => {
    process.env.CRA_API_TOKEN = 'jeton-de-test'
    const r = requireApiToken(requete('Bearer autre-jeton'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(401)
  })

  it('refuse l absence d en-tête', async () => {
    process.env.CRA_API_TOKEN = 'jeton-de-test'
    const r = requireApiToken(requete())
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(401)
  })

  it('refuse un schéma d autorisation qui n est pas Bearer', () => {
    process.env.CRA_API_TOKEN = 'jeton-de-test'
    expect(requireApiToken(requete('Basic jeton-de-test')).ok).toBe(false)
  })

  it('refuse tout quand le jeton n est pas configuré, plutôt que d ouvrir', async () => {
    // Le défaut sûr est la fermeture : une instance mal configurée ne doit
    // pas exposer son journal, ni son ordonnanceur.
    delete process.env.CRA_API_TOKEN
    const r = requireApiToken(requete('Bearer n-importe-quoi'))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.response.status).toBe(503)
    expect(await r.response.json()).toMatchObject({
      erreur: expect.stringContaining('CRA_API_TOKEN'),
    })
  })

  it('refuse un jeton vide même si la variable est vide', () => {
    process.env.CRA_API_TOKEN = ''
    expect(requireApiToken(requete('Bearer ')).ok).toBe(false)
  })

  it('ne renvoie jamais le jeton attendu dans sa réponse de refus', async () => {
    // Un message d'erreur qui recopie le secret le publie dans le journal
    // d'accès de l'appelant, et dans le sien.
    process.env.CRA_API_TOKEN = 'jeton-tres-secret'
    const r = requireApiToken(requete('Bearer faux'))
    if (r.ok) throw new Error('le jeton faux a été accepté')
    expect(await r.response.text()).not.toContain('jeton-tres-secret')
  })
})
