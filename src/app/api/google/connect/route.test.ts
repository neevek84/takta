import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { requireUser, cookies, readGoogleOAuthClient } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  cookies: vi.fn(),
  readGoogleOAuthClient: vi.fn(),
}))

vi.mock('@/auth', () => ({
  requireUser,
  // Les gardes de rôle s'appuient sur la même session, et **appliquent la vraie
  // règle** : `peutAdministrer` est importée, pas recopiée. Un double qui
  // laisserait passer un consultant ferait passer au vert une action sans
  // garde — c'est arrivé, et c'est ce test-ci qui l'a dit.
  exigerAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer, MOTIF_REFUS_ADMIN } = await import('@/core/auth/roles')
    if (!peutAdministrer(u.role)) throw new Error(MOTIF_REFUS_ADMIN)
    return u
  },
  accesAdministration: async () => {
    const u = await requireUser()
    const { peutAdministrer } = await import('@/core/auth/roles')
    return { autorise: peutAdministrer(u.role), user: u }
  },
}))
vi.mock('next/headers', () => ({ cookies }))
vi.mock('@/services/google/oauth-client', () => ({ readGoogleOAuthClient }))

import { GET } from './route'

interface CookiePose {
  name: string
  value: string
  options: { httpOnly?: boolean; sameSite?: string; path?: string; maxAge?: number }
}

const CLIENT = {
  clientId: 'client-id-de-test',
  clientSecret: 'secret-de-client-de-test',
  redirectUri: 'https://cra.test/api/google/callback',
}

let poses: CookiePose[]
let journal: string[]

/** Cookie posé à l'indice donné, ou échec explicite. */
function pose(index: number): CookiePose {
  const trouve = poses[index]
  if (trouve === undefined) throw new Error(`Aucun cookie posé à l'indice ${index}.`)
  return trouve
}

beforeEach(() => {
  poses = []
  cookies.mockReset().mockResolvedValue({
    set: (name: string, value: string, options: CookiePose['options']) => {
      poses.push({ name, value, options })
    },
  })
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  readGoogleOAuthClient.mockReset().mockResolvedValue(CLIENT)

  journal = []
  for (const canal of ['error', 'warn', 'info'] as const) {
    vi.spyOn(console, canal).mockImplementation((...a: unknown[]) => {
      journal.push(a.map(String).join(' '))
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

function requete(url = 'https://cra.test/api/google/connect'): Request {
  return new Request(url)
}

describe('départ vers le consentement', () => {
  it('redirige vers la page de consentement Google', async () => {
    const reponse = await GET(requete())
    const url = new URL(reponse.headers.get('location') ?? '')

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar')
  })

  it('emploie le client OAuth enregistré en base', async () => {
    const reponse = await GET(requete())
    const url = new URL(reponse.headers.get('location') ?? '')

    expect(url.searchParams.get('client_id')).toBe(CLIENT.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(CLIENT.redirectUri)
  })

  it('ne recopie jamais le secret du client dans la redirection de départ', async () => {
    // Le départ ne porte que l'identifiant public. Le secret ne sort qu'au
    // moment de l'échange, de serveur à serveur.
    const reponse = await GET(requete())
    expect(reponse.headers.get('location') ?? '').not.toContain(CLIENT.clientSecret)
  })

  it('dépose l état de l URL dans un cookie inaccessible au script', async () => {
    // C'est ce cookie que le retour compare : s'il n'est pas posé, ou s'il ne
    // porte pas l'état envoyé, la vérification du retour ne prouve rien.
    const reponse = await GET(requete())
    const etat = new URL(reponse.headers.get('location') ?? '').searchParams.get('state')

    expect(poses).toHaveLength(1)
    expect(pose(0).name).toBe('google_oauth_state')
    expect(pose(0).value).toBe(etat)
    expect(pose(0).value).not.toBe('')
    expect(pose(0).options.httpOnly).toBe(true)
    expect(pose(0).options.sameSite).toBe('lax')
  })

  it('tire un état différent à chaque départ', async () => {
    await GET(requete())
    await GET(requete())

    expect(pose(0).value).not.toBe(pose(1).value)
  })

  it('renvoie vers l écran de configuration quand aucun client n est enregistré', async () => {
    // Le connecteur est optionnel : une installation sans client OAuth est un
    // état légitime, pas une panne. Partir quand même vers Google afficherait
    // au visiteur une page d'erreur d'un autre site.
    readGoogleOAuthClient.mockResolvedValue(null)

    const reponse = await GET(requete())
    const url = new URL(reponse.headers.get('location') ?? '')

    expect(url.origin).toBe('https://cra.test')
    expect(url.pathname).toBe('/admin/google')
    expect(url.searchParams.get('message')).toContain('Administration · Google')
    // Un renvoi n'est pas une réussite : la tonalité part avec le message.
    expect(url.searchParams.get('tone')).not.toBe('success')
    expect(poses).toHaveLength(0)
  })

  it('journalise le motif du renvoi, sans identifiant ni URL', async () => {
    readGoogleOAuthClient.mockResolvedValue(null)

    await GET(requete())

    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('google.connect')
    expect(journal[0]).toContain('client-oauth-absent')
  })

  it('ne journalise rien quand le départ se passe bien', async () => {
    await GET(requete())
    expect(journal).toEqual([])
  })

  it('exige une session avant de poser quoi que ce soit', async () => {
    requireUser.mockRejectedValue(new Error('non authentifié'))

    await expect(GET(requete())).rejects.toThrow()
    expect(poses).toHaveLength(0)
    expect(readGoogleOAuthClient).not.toHaveBeenCalled()
  })
})

describe("l'URL de retour ne vient jamais de la requête", () => {
  it('ignore une redirect_uri passée en paramètre de la requête', async () => {
    // La faille classique de ce flux : Google renvoie le code de consentement
    // à l'URL de retour transmise. Lue dans la requête, elle donne à qui forge
    // un lien le pouvoir de faire livrer ce code chez lui — l'application y
    // ayant apposé son propre `client_id`.
    const reponse = await GET(
      requete('https://cra.test/api/google/connect?redirect_uri=https://pirate.test/vol'),
    )
    const url = new URL(reponse.headers.get('location') ?? '')

    expect(url.searchParams.get('redirect_uri')).toBe(CLIENT.redirectUri)
    expect(reponse.headers.get('location') ?? '').not.toContain('pirate.test')
  })

  it('ignore l hôte annoncé par la requête pour construire l URL de retour', async () => {
    // Même faille par une autre porte : un en-tête `Host` forgé suffirait à
    // fabriquer une URL de retour hostile si la redirection s'en servait.
    const reponse = await GET(requete('https://pirate.test/api/google/connect'))
    const url = new URL(reponse.headers.get('location') ?? '')

    expect(url.searchParams.get('redirect_uri')).toBe(CLIENT.redirectUri)
    expect(url.searchParams.get('redirect_uri')).not.toContain('pirate.test')
  })

  it('ignore un client_id passé en paramètre de la requête', async () => {
    const reponse = await GET(
      requete('https://cra.test/api/google/connect?client_id=celui-du-pirate'),
    )
    const url = new URL(reponse.headers.get('location') ?? '')

    expect(url.searchParams.get('client_id')).toBe(CLIENT.clientId)
  })
})
