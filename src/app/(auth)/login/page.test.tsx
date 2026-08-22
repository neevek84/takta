// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('./actions', () => ({
  login: vi.fn(),
  creerPremierAdmin: vi.fn(),
  connexionGoogle: vi.fn(),
}))

// La page interroge la base pour savoir si l'instance est neuve. Le double le
// dit sans base : le rendu est ce qu'on teste ici, pas le comptage.
const { aucunUtilisateur, getGoogleOAuthClientView } = vi.hoisted(() => ({
  aucunUtilisateur: vi.fn(),
  getGoogleOAuthClientView: vi.fn(),
}))
vi.mock('@/services/auth/comptes', () => ({ aucunUtilisateur }))
vi.mock('@/services/google/oauth-client', () => ({ getGoogleOAuthClientView }))

// `vi.mock` est hissé au-dessus des imports : l'action serveur (et donc
// `@/auth`, Prisma, argon2) n'est jamais chargée, seul le rendu l'est.
import LoginPage from './page'

beforeEach(() => {
  // Par défaut, une instance déjà peuplée : c'est le cas courant.
  aucunUtilisateur.mockReset().mockResolvedValue(false)
  // Et un client Google enregistré : la seconde porte existe.
  getGoogleOAuthClientView.mockReset().mockResolvedValue({ clientId: '123', redirectUri: 'x' })
})

afterEach(cleanup)

describe('page de connexion', () => {
  it('ne montre aucun bandeau au premier chargement', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect((screen.getByLabelText('Adresse e-mail') as HTMLInputElement).value).toBe('')
  })

  it('après un échec, affiche le message en français et conserve l’e-mail saisi', async () => {
    render(
      await LoginPage({
        searchParams: Promise.resolve({ erreur: '1', email: 'ada@example.com' }),
      }),
    )

    const bandeau = screen.getByRole('alert')
    expect(bandeau.textContent).toContain('Adresse e-mail ou mot de passe incorrect.')
    expect((screen.getByLabelText('Adresse e-mail') as HTMLInputElement).value).toBe(
      'ada@example.com',
    )
  })
})

describe('le premier démarrage', () => {
  // Une instance neuve est murée : sans cet écran, il n'existe aucun moyen de
  // créer le premier compte sans terminal — ce que le porteur d'un NAS n'a pas
  // toujours.
  it("propose de créer l'administrateur quand aucun compte n'existe", async () => {
    aucunUtilisateur.mockResolvedValue(true)

    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('button', { name: /Créer le premier administrateur/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Se connecter' })).toBeNull()
  })

  // La fenêtre ne se rouvre jamais : dès qu'un compte existe, cet écran doit
  // avoir disparu. Le service refuse de toute façon, mais un écran qui propose
  // ce qui sera refusé est un écran qui ment.
  it('disparaît dès qu un compte existe', async () => {
    aucunUtilisateur.mockResolvedValue(false)

    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('button', { name: /Créer le premier administrateur/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeTruthy()
  })
})


/**
 * **La seconde porte du mot de passe.**
 *
 * Ce parcours ne sert pas que l'oubli : c'est par lui qu'un compte né *sans*
 * mot de passe — reprise Dolibarr, connexion Google — s'en donne un. Sans ce
 * lien, l'écran de connexion serait le seul endroit d'où l'on peut partir, et
 * il n'y mènerait pas.
 */
describe('le lien vers la définition du mot de passe', () => {
  it('mène à /mot-de-passe, et dit « définir » autant que « réinitialiser »', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    const lien = screen.getByRole('link', { name: /Définir ou réinitialiser mon mot de passe/ })
    expect(lien.getAttribute('href')).toBe('/mot-de-passe')
  })

  // Le pied de page ne porte que la version, et disparaît quand elle manque
  // (voir plus bas). Y loger le lien le ferait disparaître avec elle.
  it('ne se loge pas dans le pied de page, qui n’est pas toujours là', async () => {
    const { container } = render(await LoginPage({ searchParams: Promise.resolve({}) }))

    const lien = screen.getByRole('link', { name: /Définir ou réinitialiser/ })
    expect(lien.closest('footer')).toBeNull()
    expect(container.querySelector('footer')?.textContent ?? '').not.toContain('Définir')
  })

  // Sur une instance vide, il n'y a aucun compte à qui envoyer quoi que ce
  // soit : proposer le lien serait proposer une impasse.
  it('ne paraît pas au premier démarrage, où aucun compte n’existe', async () => {
    aucunUtilisateur.mockResolvedValue(true)

    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('link', { name: /Définir ou réinitialiser/ })).toBeNull()
  })
})

/**
 * **Le seul écran qui puisse dire la version à qui n'est pas encore entré.**
 *
 * Container Manager n'affiche que l'identifiant *local* de l'image, qui ne
 * correspond à aucune empreinte du registre : le porteur a déployé une mise à
 * jour sans pouvoir vérifier laquelle tournait. La navigation la porte déjà,
 * mais elle est derrière la porte — et c'est justement quand on n'arrive pas à
 * entrer qu'on a besoin de savoir ce qui tourne.
 */
describe('la version affichée avant la connexion', () => {
  it('paraît quand la construction l’a figée', async () => {
    const avant = process.env.TAKTA_VERSION
    process.env.TAKTA_VERSION = '9.9.9'
    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('v9.9.9')).not.toBeNull()

    if (avant === undefined) delete process.env.TAKTA_VERSION
    else process.env.TAKTA_VERSION = avant
  })

  // Rien plutôt qu'« inconnue » : un mot qui ressemble à une réponse en tient
  // lieu, et on cesse de chercher.
  it('ne laisse aucune trace quand rien n’a été figé', async () => {
    const avant = process.env.TAKTA_VERSION
    delete process.env.TAKTA_VERSION
    const { container } = render(await LoginPage({ searchParams: Promise.resolve({}) }))

    // Le pied de page entier disparaît : il ne portait que ça.
    expect(container.querySelector('footer')).toBeNull()

    if (avant !== undefined) process.env.TAKTA_VERSION = avant
  })
})

describe('la seconde porte', () => {
  it('propose les deux quand un client Google est enregistré', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Google/ })).toBeTruthy()
  })

  // Une porte qui ne mène nulle part ne s'affiche pas grisée : elle ne
  // s'affiche pas du tout. Sans client enregistré, `signIn('google')`
  // échouerait sur un `invalid_client` que personne ne sait lire.
  it("s'efface quand aucun client Google n'est enregistré", async () => {
    getGoogleOAuthClientView.mockResolvedValue(null)
    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeTruthy()
  })

  // Au premier démarrage il n'existe aucun compte : entrer par Google en
  // créerait un, `CONSULTANT`, et l'instance n'aurait jamais d'administrateur.
  it('ne paraît pas au premier démarrage', async () => {
    aucunUtilisateur.mockResolvedValue(true)
    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull()
  })
})
