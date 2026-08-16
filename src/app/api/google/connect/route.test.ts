import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireUser, cookies } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  cookies: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/headers', () => ({ cookies }))

import { GET } from './route'

interface CookiePose {
  name: string
  value: string
  options: { httpOnly?: boolean; sameSite?: string; path?: string; maxAge?: number }
}

let poses: CookiePose[]

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

  process.env.GOOGLE_CLIENT_ID = 'client-id-de-test'
  process.env.GOOGLE_REDIRECT_URI = 'https://cra.test/api/google/callback'
})

function requete(): Request {
  return new Request('https://cra.test/api/google/connect')
}

describe('départ vers le consentement', () => {
  it('redirige vers la page de consentement Google', async () => {
    const reponse = await GET(requete())
    const url = new URL(reponse.headers.get('location') ?? '')

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar')
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

  it('renvoie un message quand aucun client Google n est configuré', async () => {
    // Le connecteur est optionnel : un déploiement sans identifiants Google
    // est un état légitime, pas une panne. Partir quand même vers Google
    // afficherait au visiteur une page d'erreur d'un autre site.
    process.env.GOOGLE_CLIENT_ID = ''

    const reponse = await GET(requete())
    const url = new URL(reponse.headers.get('location') ?? '')

    expect(url.origin).toBe('https://cra.test')
    expect(url.pathname).toBe('/admin/sync')
    expect(url.searchParams.get('message')).toContain('pas configurée')
    expect(poses).toHaveLength(0)
  })

  it('exige une session avant de poser quoi que ce soit', async () => {
    requireUser.mockRejectedValue(new Error('non authentifié'))

    await expect(GET(requete())).rejects.toThrow()
    expect(poses).toHaveLength(0)
  })
})
