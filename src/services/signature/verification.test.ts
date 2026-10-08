import { describe, it, expect } from 'vitest'
import type { SignatureFetchLike } from '@/core/signature/connector'
import { verifierDocumenso, type Verification } from './verification'

const BASE = 'https://documenso.test'
const CLE = 'api_cle_de_verification_0000'

interface Appel {
  url: string
  method: string
  headers: Record<string, string>
}

/**
 * Le double d'une instance Documenso, réduit à ce que la vérification touche.
 * **Il refuse ce que Documenso refuserait** : la clé sur toute route de l'API
 * v2, 404 sur une route inconnue — et toute écriture, parce qu'une
 * vérification qui créerait quoi que ce soit chez le prestataire n'est plus
 * une vérification.
 *
 * Le corps des refus recopie la clé reçue, exprès : c'est ce qu'un proxy
 * bavard ferait, et le message de la vérification ne doit jamais la reprendre.
 */
function fausseInstance(options: { v2?: boolean; html?: boolean; panne?: number } = {}) {
  const appels: Appel[] = []
  const fetchFn: SignatureFetchLike = async (url, init) => {
    appels.push({ url, method: init.method, headers: init.headers })
    if (init.method !== 'GET') return new Response('écriture interdite', { status: 405 })
    if (options.panne !== undefined) {
      return new Response(`panne ${init.headers.Authorization}`, { status: options.panne })
    }
    if (options.html === true) {
      return new Response('<html>accueil</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    }
    if (!url.startsWith(`${BASE}/api/v2/`) || options.v2 === false) {
      return new Response(`Inconnu ${init.headers.Authorization}`, { status: 404 })
    }
    if (init.headers.Authorization !== CLE) {
      return new Response(`Clé refusée : ${init.headers.Authorization}`, { status: 401 })
    }
    return new Response(JSON.stringify({ data: [], count: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return { fetchFn, appels }
}

function etat(verifications: Verification[], cle: Verification['cle']): Verification {
  const v = verifications.find((x) => x.cle === cle)
  if (!v) throw new Error(`vérification ${cle} absente`)
  return v
}

describe('verifierDocumenso', () => {
  it('tout est vert : instance, clé, API v2 et SMTP', async () => {
    const { fetchFn } = fausseInstance()
    const r = await verifierDocumenso({ baseUrl: `${BASE}/`, apiKey: CLE, fetchFn, smtpConfigure: true })

    expect(r.ok).toBe(true)
    expect(r.verifications.map((v) => [v.cle, v.etat])).toEqual([
      ['instance', 'ok'],
      ['api-v2', 'ok'],
      ['cle', 'ok'],
      ['smtp', 'ok'],
    ])
    // Chaque ligne se lit en toutes lettres : la couleur ne porte rien seule.
    for (const v of r.verifications) expect(v.texte.length).toBeGreaterThan(10)
  })

  it('ne fait qu une lecture authentifiée, et ne crée rien chez le prestataire', async () => {
    const { fetchFn, appels } = fausseInstance()
    await verifierDocumenso({ baseUrl: BASE, apiKey: CLE, fetchFn, smtpConfigure: true })

    expect(appels).toHaveLength(1)
    expect(appels[0]!.method).toBe('GET')
    // La recherche de documents existe depuis Documenso 2.0.0 ; la recherche
    // d'enveloppes est plus récente et ferait conclure à tort à une 1.x.
    expect(appels[0]!.url).toBe(`${BASE}/api/v2/document?page=1&perPage=1`)
    expect(appels[0]!.headers.Authorization).toBe(CLE)
  })

  it('une clé refusée se dit, sans reprendre le corps de la réponse', async () => {
    const { fetchFn } = fausseInstance()
    const r = await verifierDocumenso({
      baseUrl: BASE,
      apiKey: 'cle-fausse-recopiee-par-le-proxy',
      fetchFn,
      smtpConfigure: true,
    })

    expect(r.ok).toBe(false)
    expect(etat(r.verifications, 'instance').etat).toBe('ok')
    expect(etat(r.verifications, 'cle').etat).toBe('echec')
    expect(etat(r.verifications, 'cle').texte).toMatch(/refusée/)
    expect(JSON.stringify(r)).not.toContain('cle-fausse-recopiee-par-le-proxy')
  })

  it('un 404 sur l API v2 invite à vérifier l URL, ou la version 2.0', async () => {
    const { fetchFn } = fausseInstance({ v2: false })
    const r = await verifierDocumenso({ baseUrl: BASE, apiKey: CLE, fetchFn, smtpConfigure: true })

    expect(r.ok).toBe(false)
    expect(etat(r.verifications, 'instance').etat).toBe('ok')
    expect(etat(r.verifications, 'api-v2').etat).toBe('echec')
    expect(etat(r.verifications, 'api-v2').texte).toContain('API v2 introuvable : vérifiez l\'URL de l\'instance, ou Documenso 2.0 ou plus est requis.')
    // Sans route, la clé n'a pas été jugée : ni vert ni rouge.
    expect(etat(r.verifications, 'cle').etat).toBe('non-verifie')
    expect(JSON.stringify(r)).not.toContain(CLE)
  })

  it('une instance injoignable se dit, et le reste n est pas vérifié', async () => {
    const fetchFn: SignatureFetchLike = async () => {
      throw new TypeError(`fetch failed ${CLE}`)
    }
    const r = await verifierDocumenso({ baseUrl: BASE, apiKey: CLE, fetchFn, smtpConfigure: true })

    expect(r.ok).toBe(false)
    expect(etat(r.verifications, 'instance').etat).toBe('echec')
    expect(etat(r.verifications, 'api-v2').etat).toBe('non-verifie')
    expect(etat(r.verifications, 'cle').etat).toBe('non-verifie')
    expect(JSON.stringify(r)).not.toContain(CLE)
  })

  it('une panne du prestataire n est ni un refus de clé ni une 1.x', async () => {
    const { fetchFn } = fausseInstance({ panne: 502 })
    const r = await verifierDocumenso({ baseUrl: BASE, apiKey: CLE, fetchFn, smtpConfigure: true })

    expect(etat(r.verifications, 'instance').etat).toBe('echec')
    expect(etat(r.verifications, 'instance').texte).toContain('502')
    expect(etat(r.verifications, 'cle').etat).toBe('non-verifie')
    expect(JSON.stringify(r)).not.toContain(CLE)
  })

  it('une adresse qui répond une page web n est pas une API Documenso', async () => {
    const { fetchFn } = fausseInstance({ html: true })
    const r = await verifierDocumenso({ baseUrl: BASE, apiKey: CLE, fetchFn, smtpConfigure: true })

    expect(r.ok).toBe(false)
    expect(etat(r.verifications, 'api-v2').etat).toBe('echec')
    expect(etat(r.verifications, 'cle').etat).toBe('non-verifie')
  })

  it('SMTP absent est un échec : le circuit refuserait l envoi', async () => {
    const { fetchFn } = fausseInstance()
    const r = await verifierDocumenso({ baseUrl: BASE, apiKey: CLE, fetchFn, smtpConfigure: false })

    expect(r.ok).toBe(false)
    expect(etat(r.verifications, 'smtp').etat).toBe('echec')
    expect(etat(r.verifications, 'smtp').texte).toMatch(/SMTP/)
  })
})
