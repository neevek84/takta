import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SecretBoxError } from '@/core/crypto/secret-box'

const { requireUser, connectGoogle, cookies } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  connectGoogle: vi.fn(),
  cookies: vi.fn(),
}))

vi.mock('@/auth', () => ({ requireUser }))
vi.mock('next/headers', () => ({ cookies }))
// Seule `connectGoogle` est doublée. `GoogleClientAbsentError` reste la vraie
// classe : la route s'en sert dans un `instanceof`, et un double la rendrait
// toujours fausse — le test passerait en décrivant une branche jamais prise.
vi.mock('@/services/google/connect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/google/connect')>()),
  connectGoogle,
}))

import { GET } from './route'

/** Bocal à cookies minimal : seul le comportement observé par la route. */
function bocal(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    store,
    get: (name: string) => {
      const value = store.get(name)
      return value === undefined ? undefined : { name, value }
    },
    set: (name: string, value: string) => {
      store.set(name, value)
    },
    delete: (name: string) => {
      store.delete(name)
    },
  }
}

function requete(query: string): Request {
  return new Request(`https://cra.test/api/google/callback${query}`)
}

/** Destination effective de la redirection rendue. */
function destination(reponse: Response): URL {
  const location = reponse.headers.get('location')
  expect(location).not.toBeNull()
  return new URL(location as string)
}

let jar: ReturnType<typeof bocal>
let journal: string[]

beforeEach(() => {
  jar = bocal({ google_oauth_state: 'etat-attendu' })
  cookies.mockReset().mockResolvedValue(jar)
  requireUser.mockReset().mockResolvedValue({ id: 'u1', role: 'ADMIN' })
  connectGoogle.mockReset().mockResolvedValue({ calendarId: 'cal-1' })
  journal = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    journal.push(a.map(String).join(' '))
  })
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
    journal.push(a.map(String).join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('vérification de l état', () => {
  it('connecte le compte quand l état revient identique', async () => {
    // Le compte visé vient de la session, jamais de la requête : les
    // paramètres d'identité ci-dessous doivent rester sans effet.
    const reponse = await GET(requete('?state=etat-attendu&code=code-google&userId=u2&user=u2'))

    expect(connectGoogle).toHaveBeenCalledWith({ userId: 'u1', code: 'code-google' })
    expect(destination(reponse).pathname).toBe('/admin/sync')
    expect(destination(reponse).searchParams.get('message')).toBe('Google Calendar est connecté.')
  })

  it('refuse un état qui ne correspond pas au cookie', async () => {
    // Sans cette vérification, n'importe qui pourrait faire attacher au compte
    // de la victime un compte Google qu'il contrôle, d'un simple lien.
    const reponse = await GET(requete('?state=etat-forge&code=code-de-l-attaquant'))

    expect(connectGoogle).not.toHaveBeenCalled()
    expect(destination(reponse).searchParams.get('message')).toContain('refusée')
  })

  it('refuse un retour sans cookie d état', async () => {
    jar.store.delete('google_oauth_state')

    const reponse = await GET(requete('?state=&code=code-de-l-attaquant'))

    expect(connectGoogle).not.toHaveBeenCalled()
    expect(destination(reponse).searchParams.get('message')).toContain('refusée')
  })

  it('consomme l état : le même retour rejoué est refusé', async () => {
    await GET(requete('?state=etat-attendu&code=code-google'))
    connectGoogle.mockClear()

    const rejeu = await GET(requete('?state=etat-attendu&code=code-google'))

    expect(jar.store.has('google_oauth_state')).toBe(false)
    expect(connectGoogle).not.toHaveBeenCalled()
    expect(destination(rejeu).searchParams.get('message')).toContain('refusée')
  })
})

describe('destination du retour', () => {
  it('ignore une destination soufflée par la requête', async () => {
    // Une redirection dont l'adresse vient de la requête ferait de ce point
    // d'entrée un tremplin vers un site tiers, sous notre nom de domaine.
    const reponse = await GET(
      requete(
        '?state=etat-attendu&code=c&next=https%3A%2F%2Fmechant.test%2Fvol' +
          '&redirect_uri=https%3A%2F%2Fmechant.test%2Fvol' +
          '&returnTo=%2F%2Fmechant.test',
      ),
    )

    const url = destination(reponse)
    expect(url.origin).toBe('https://cra.test')
    expect(url.pathname).toBe('/admin/sync')
  })
})

describe('la tonalité voyage avec le message', () => {
  it('marque le succès comme un succès', async () => {
    const reponse = await GET(requete('?state=etat-attendu&code=code-google'))
    expect(destination(reponse).searchParams.get('tone')).toBe('success')
  })

  it.each([
    ['annulation chez Google', '?error=access_denied&state=etat-attendu'],
    ['état forgé', '?state=etat-forge&code=c'],
    ['code absent', '?state=etat-attendu'],
  ])('ne marque pas %s comme un succès', async (_cas, query) => {
    // Cet écran affichait tout retour à l'identique : « Connexion Google
    // refusée » avait exactement l'apparence de « Google Calendar est
    // connecté ». Un refus qui repart en `tone=success` rouvre ce défaut.
    const reponse = await GET(requete(query))
    expect(destination(reponse).searchParams.get('tone')).toBe('danger')
  })

  it('ne marque pas un échec de connexion comme un succès', async () => {
    connectGoogle.mockRejectedValue(new Error('invalid_grant'))
    const reponse = await GET(requete('?state=etat-attendu&code=code-google'))
    expect(destination(reponse).searchParams.get('tone')).toBe('danger')
  })

  it('dit que le client OAuth manque au lieu de conseiller de réessayer', async () => {
    // Recommencer ne changera rien tant que le client n'est pas ressaisi :
    // c'est l'écran d'administration qu'il faut atteindre, pas le bouton.
    const { GoogleClientAbsentError } = await import('@/services/google/connect')
    connectGoogle.mockRejectedValue(new GoogleClientAbsentError())

    const reponse = await GET(requete('?state=etat-attendu&code=code-google'))
    const message = destination(reponse).searchParams.get('message') ?? ''

    expect(message).toContain('Administration · Google')
    expect(destination(reponse).searchParams.get('tone')).toBe('danger')
  })
})

describe('retours dégradés', () => {
  it('ne connecte rien quand Google renvoie une erreur', async () => {
    const reponse = await GET(requete('?error=access_denied&state=etat-attendu'))

    expect(connectGoogle).not.toHaveBeenCalled()
    expect(destination(reponse).searchParams.get('message')).toBe('Connexion Google annulée.')
  })

  it('ne connecte rien quand aucun code n accompagne l état', async () => {
    const reponse = await GET(requete('?state=etat-attendu'))

    expect(connectGoogle).not.toHaveBeenCalled()
    expect(destination(reponse).searchParams.get('message')).toContain('aucun code')
  })

  it('reste sur un message lisible quand la connexion échoue', async () => {
    connectGoogle.mockRejectedValue(new Error('invalid_grant sur https://oauth2.googleapis.com'))

    const reponse = await GET(requete('?state=etat-attendu&code=code-google'))
    const message = destination(reponse).searchParams.get('message') ?? ''

    expect(message).toBe('La connexion Google a échoué. Réessayez.')
    expect(message).not.toContain('invalid_grant')
  })

  it('journalise la cause au lieu de la perdre', async () => {
    // Sans cette trace, l'exploitant n'a strictement rien : l'écran dit
    // « Réessayez » et le serveur ne dit rien du tout.
    connectGoogle.mockRejectedValue(new Error('invalid_grant sur https://oauth2.googleapis.com'))

    await GET(requete('?state=etat-attendu&code=code-google'))

    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('google.callback')
    expect(journal[0]).toContain('invalid_grant')
    expect(journal[0]).toContain('userId=u1')
    // Le code de consentement est un secret à usage unique : il n'a rien à
    // faire dans un journal.
    expect(journal[0]).not.toContain('code-google')
  })

  it('dit que la clé manque au lieu de conseiller de réessayer', async () => {
    // Le cas exact de l'ordre du .env.example : les variables Google sont
    // posées, CREDENTIALS_KEY est oubliée. « Réessayez » envoie l'utilisateur
    // recommencer une opération qui ne peut jamais aboutir.
    connectGoogle.mockRejectedValue(
      new SecretBoxError("CREDENTIALS_KEY est absente de l'environnement."),
    )

    const reponse = await GET(requete('?state=etat-attendu&code=code-google'))
    const message = destination(reponse).searchParams.get('message') ?? ''

    expect(message).toContain('CREDENTIALS_KEY')
    expect(message).not.toContain('Réessayez')
    expect(journal[0]).toContain('CREDENTIALS_KEY')
  })

  it('exige une session avant tout échange', async () => {
    requireUser.mockRejectedValue(new Error('non authentifié'))

    await expect(GET(requete('?state=etat-attendu&code=code-google'))).rejects.toThrow()
    expect(connectGoogle).not.toHaveBeenCalled()
  })
})
