import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CredentialsSignin } from '@auth/core/errors'

const { signIn, redirect, revalidatePath, creerPremierAdministrateur } = vi.hoisted(() => ({
  signIn: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  creerPremierAdministrateur: vi.fn(),
}))
vi.mock('@/auth', () => ({ signIn }))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('next/cache', () => ({ revalidatePath }))
vi.mock('@/services/auth/comptes', () => ({ creerPremierAdministrateur }))

// `vi.mock` est hissé au-dessus des imports : `@/auth` (Prisma, argon2)
// n'est jamais chargé, seul le contrat avec `signIn` l'est.
import { creerPremierAdmin, login } from './actions'

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
  revalidatePath.mockReset()
  creerPremierAdministrateur.mockReset()
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

function formulairePremierAdmin(): FormData {
  const fd = new FormData()
  fd.set('name', 'Ada')
  fd.set('email', 'ada@exemple.test')
  fd.set('motDePasse', 'un-mot-de-passe-long')
  return fd
}

/**
 * **Le compte se créait, et l'écran ne bougeait pas.**
 *
 * L'action rendait un état, sans rien d'autre : le composant client affichait
 * « Compte créé », mais le composant *serveur* qui décide entre « Premier
 * démarrage » et « Connexion » n'était jamais réévalué. Le formulaire de
 * création restait à l'écran au-dessus de son propre message de succès —
 * lequel invitait à se connecter sur un écran qui ne le permettait pas.
 * Constaté sur l'instance déployée, et il fallait revenir à la main sur
 * l'adresse du site pour en sortir.
 */
describe('la création du premier administrateur', () => {
  it("quitte l'écran de création dès que le compte existe", async () => {
    creerPremierAdministrateur.mockResolvedValue({ ok: true })

    await creerPremierAdmin(null, formulairePremierAdmin())

    // Le cache de route porte encore « aucun compte » : sans cette purge, la
    // page revenue reste celle d'avant.
    expect(revalidatePath).toHaveBeenCalledWith('/login')
    const [url] = redirect.mock.calls[0] as [string]
    expect(url).toBe('/login?cree=1')
  })

  it('un refus reste sur place et dit pourquoi', async () => {
    creerPremierAdministrateur.mockResolvedValue({ ok: false, motif: 'Un compte existe déjà.' })

    const etat = await creerPremierAdmin(null, formulairePremierAdmin())

    expect(etat).toEqual({ message: 'Un compte existe déjà.' })
    // Rediriger sur un refus ferait disparaître le motif, et le formulaire
    // reviendrait vide sans que rien n'explique l'échec.
    expect(redirect).not.toHaveBeenCalled()
  })
})
