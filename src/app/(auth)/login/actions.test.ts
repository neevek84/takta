import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CredentialsSignin } from '@auth/core/errors'

const { signIn, redirect } = vi.hoisted(() => ({
  signIn: vi.fn(),
  redirect: vi.fn(),
}))
vi.mock('@/auth', () => ({ signIn }))
vi.mock('next/navigation', () => ({ redirect }))

// `vi.mock` est hissé au-dessus des imports : `@/auth` (Prisma, argon2)
// n'est jamais chargé, seul le contrat avec `signIn` l'est.
import { login } from './actions'

/**
 * Simule l'exception qu'Auth.js lève réellement en cas de succès : ni
 * `CredentialsSignin`, ni aucune autre `AuthError` — un simple `Error` porté
 * par `redirect()` de Next, identifié par son `digest`. C'est précisément ce
 * que le `catch` de `login` ne doit jamais avaler.
 */
function erreurDeRedirectionReussie(): Error {
  const err = new Error('NEXT_REDIRECT')
  Object.assign(err, { digest: 'NEXT_REDIRECT;push;/saisie;307;' })
  return err
}

function formulaire(email: string, password: string): FormData {
  const fd = new FormData()
  fd.set('email', email)
  fd.set('password', password)
  return fd
}

beforeEach(() => {
  signIn.mockReset()
  redirect.mockReset()
})

describe('login (action serveur)', () => {
  it('un mot de passe erroné affiche le message et ne fait pas tomber la page', async () => {
    signIn.mockRejectedValue(new CredentialsSignin())

    await expect(login(formulaire('ada@example.com', 'mauvais'))).resolves.toBeUndefined()

    expect(redirect).toHaveBeenCalledTimes(1)
    const [url] = redirect.mock.calls[0] as [string]
    expect(url).toContain('erreur=1')
    expect(url).toContain(encodeURIComponent('ada@example.com'))
  })

  it('un compte inconnu affiche le même message générique (n’énumère pas les comptes)', async () => {
    signIn.mockRejectedValue(new CredentialsSignin())

    await login(formulaire('inconnu@example.com', 'peu importe'))

    const [url] = redirect.mock.calls[0] as [string]
    expect(url).toContain('erreur=1')
  })

  it('la connexion réussie laisse la redirection Next se propager, sans être avalée', async () => {
    const redirectionReussie = erreurDeRedirectionReussie()
    signIn.mockRejectedValue(redirectionReussie)

    await expect(login(formulaire('ada@example.com', 'bon-mdp'))).rejects.toBe(
      redirectionReussie,
    )
    // La redirection de succès n'a rien à voir avec notre gestion de l'échec.
    expect(redirect).not.toHaveBeenCalled()
  })

  it('une erreur imprévue (ni identifiants, ni redirection) continue de se propager', async () => {
    const panne = new Error('base indisponible')
    signIn.mockRejectedValue(panne)

    await expect(login(formulaire('ada@example.com', 'x'))).rejects.toBe(panne)
    expect(redirect).not.toHaveBeenCalled()
  })
})
