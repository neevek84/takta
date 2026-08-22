import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { hashPassword, verifyPassword } from './auth-password'
import { prisma } from '@/db/client'

// `requireUser` lit la session via le `auth()` produit par NextAuth au moment
// de l'import du module. On remplace donc NextAuth lui-même : le test pilote
// la session, la base reste réelle — c'est justement l'écart entre les deux
// que la fonction doit détecter.
//
// L'appel à NextAuth est capturé, et non simplement neutralisé : ce que la
// configuration *est* — une fonction, et non un objet — est devenu une règle,
// et une règle qui n'est vue par personne se perd au premier remaniement.
const { authMock, nextAuthMock, lireClientMock, lierMock, enregistrerMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  nextAuthMock: vi.fn((_config: unknown) => ({
    handlers: {},
    auth: authMock,
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
  lireClientMock: vi.fn(),
  lierMock: vi.fn(),
  enregistrerMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ default: nextAuthMock }))

// Le client OAuth, la fusion et l'enregistrement d'agenda sont pilotés d'ici :
// ce qui s'éprouve à ce niveau, c'est **le branchement** — quelle porte existe,
// et qui entre par elle. Les trois règles branchées ont chacune leur propre
// test, sur la vraie base, dans leur propre fichier.
vi.mock('@/services/google/oauth-client', () => ({ readGoogleOAuthClient: lireClientMock }))
vi.mock('@/services/auth/comptes', () => ({ lierOuCreerCompteGoogle: lierMock }))
vi.mock('@/services/google/connect', () => ({ enregistrerEtPreparerAgenda: enregistrerMock }))
vi.mock('next-auth/providers/credentials', () => ({
  default: vi.fn(() => ({ id: 'credentials' })),
}))

// eslint-disable-next-line import/first -- `vi.mock` est hissé au-dessus des imports.
import { requireUser } from './auth'

describe('mots de passe', () => {
  it('produit une empreinte différente du clair', async () => {
    const h = await hashPassword('motdepasse123')
    expect(h).not.toBe('motdepasse123')
    expect(h.length).toBeGreaterThan(20)
  })

  it('valide le bon mot de passe', async () => {
    const h = await hashPassword('motdepasse123')
    expect(await verifyPassword(h, 'motdepasse123')).toBe(true)
  })

  it('rejette un mauvais mot de passe', async () => {
    const h = await hashPassword('motdepasse123')
    expect(await verifyPassword(h, 'mauvais')).toBe(false)
  })

  it('produit deux empreintes différentes pour le même clair', async () => {
    const a = await hashPassword('identique')
    const b = await hashPassword('identique')
    expect(a).not.toBe(b)
  })
})

describe('requireUser', () => {
  let userId = ''

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: { email: 'require-user@test.local', name: 'R', passwordHash: 'x', role: 'ADMIN' },
    })
    userId = u.id
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: 'require-user@test.local' } })
    await prisma.$disconnect()
  })

  it('refuse une requête sans session', async () => {
    authMock.mockResolvedValue(null)
    await expect(requireUser()).rejects.toThrow('Non authentifié')
  })

  it('refuse une session sans identifiant', async () => {
    authMock.mockResolvedValue({ user: { email: 'x@test.local' } })
    await expect(requireUser()).rejects.toThrow('Non authentifié')
  })

  // Le défaut observé en usage réel : après recréation de la table `User`, le
  // jeton porte un identifiant qui n'existe plus. Sans vérification, la page
  // s'affiche et la première écriture touchant une clé étrangère plante
  // (`Foreign key constraint violated` dans `assignment.create`). Une session
  // dont l'utilisateur a disparu doit être rejetée à l'authentification.
  it("refuse une session dont l'utilisateur n'existe plus en base", async () => {
    authMock.mockResolvedValue({ user: { id: 'utilisateur-supprime', role: 'ADMIN' } })
    await expect(requireUser()).rejects.toThrow('Non authentifié')
  })

  it("rend l'utilisateur existant, avec le rôle lu en base", async () => {
    // Rôle périmé dans le jeton : la base fait foi.
    authMock.mockResolvedValue({ user: { id: userId, role: 'CONSULTANT' } })
    expect(await requireUser()).toEqual({ id: userId, role: 'ADMIN' })
  })
})

describe('un compte désactivé n a plus de session', () => {
  // Un jeton signé survit à la désactivation : il ne prouve que sa propre
  // signature. Sans cette relecture, couper un accès ne couperait rien avant
  // l'expiration du jeton — c'est-à-dire trente jours, par défaut.
  it('refuse la session d un compte désactivé', async () => {
    const u = await prisma.user.create({
      data: {
        email: 'desactive@test.local',
        name: 'Coupé',
        passwordHash: '',
        role: 'CONSULTANT',
        disabled: true,
      },
    })
    authMock.mockResolvedValue({ user: { id: u.id } })

    await expect(requireUser()).rejects.toThrow('Non authentifié')

    await prisma.user.delete({ where: { id: u.id } })
  })

  it('laisse entrer un compte actif', async () => {
    const u = await prisma.user.create({
      data: { email: 'actif@test.local', name: 'Actif', passwordHash: '', role: 'CONSULTANT' },
    })
    authMock.mockResolvedValue({ user: { id: u.id } })

    await expect(requireUser()).resolves.toEqual({ id: u.id, role: 'CONSULTANT' })

    await prisma.user.delete({ where: { id: u.id } })
  })
})

describe('la configuration Auth.js', () => {
  // Le client OAuth de l'instance vit **chiffré en base**. Une configuration
  // figée au chargement du module ne peut pas le lire : le fournisseur Google
  // n'existerait alors jamais, quel que soit ce qui est enregistré. Ce que ce
  // test garde n'est donc pas le contenu de la liste, mais sa paresse — que la
  // bibliothèque reçoive une fonction là où un objet passerait aussi.
  it('est une fonction, évaluée par requête et non au chargement', () => {
    expect(nextAuthMock).toHaveBeenCalledTimes(1)
    expect(typeof nextAuthMock.mock.calls[0]?.[0]).toBe('function')
  })

  // La connexion par mot de passe est une propriété du produit : elle ne
  // disparaît pas parce qu'une autre porte s'ouvre à côté.
  it('porte toujours la connexion par mot de passe', async () => {
    lireClientMock.mockResolvedValue(null)

    expect((await construireConfig()).providers).toContainEqual({ id: 'credentials' })
  })
})

/** Rejoue la fabrique de configuration passée à NextAuth, telle qu'une requête la déclenche. */
async function construireConfig(): Promise<{
  providers: { id?: string; options?: Record<string, unknown> }[]
  callbacks: { signIn: (p: unknown) => Promise<boolean> }
}> {
  const construire = nextAuthMock.mock.calls[0]?.[0] as () => Promise<{
    providers: { id?: string; options?: Record<string, unknown> }[]
    callbacks: { signIn: (p: unknown) => Promise<boolean> }
  }>
  return construire()
}

const CLIENT = {
  clientId: 'client-id-de-test',
  clientSecret: 'client-secret-de-test',
  redirectUri: 'http://localhost:3000/api/auth/callback/google',
}

describe('la porte Google', () => {
  beforeEach(() => {
    lireClientMock.mockReset()
    lierMock.mockReset()
    enregistrerMock.mockReset()
  })

  // Une porte qui ne mène nulle part ne s'affiche pas grisée : elle ne
  // s'affiche pas. Le bouton de l'écran de connexion se déduit de la liste des
  // fournisseurs — sans client enregistré, il n'y a rien à peindre.
  it("n'existe pas tant qu'aucun client OAuth n'est enregistré", async () => {
    lireClientMock.mockResolvedValue(null)

    expect((await construireConfig()).providers.map((p) => p.id)).not.toContain('google')
  })

  it('apparaît dès que le client est enregistré, avec le secret lu en base', async () => {
    lireClientMock.mockResolvedValue(CLIENT)
    const google = (await construireConfig()).providers.find((p) => p.id === 'google')

    expect(google?.options).toMatchObject({
      clientId: CLIENT.clientId,
      clientSecret: CLIENT.clientSecret,
    })
  })

  // Trois règles en un objet : l'agenda entre dans le même consentement,
  // `prompt=consent` fait revenir le jeton de rafraîchissement à chaque
  // connexion — sans lui, un compte reconnecté après révocation resterait
  // muet — et `include_granted_scopes` reste absent : il ferait hériter le
  // jeton de tout ce que le projet Google a jamais obtenu, `gmail.send`
  // compris.
  it('demande l identité et l agenda, hors ligne, sans hériter d aucun autre droit', async () => {
    lireClientMock.mockResolvedValue(CLIENT)
    const google = (await construireConfig()).providers.find((p) => p.id === 'google')
    const params = (
      google?.options?.authorization as { params: Record<string, string | undefined> }
    ).params

    expect(params.scope).toBe('openid email profile https://www.googleapis.com/auth/calendar')
    expect(params.access_type).toBe('offline')
    expect(params.prompt).toBe('consent')
    expect(params.include_granted_scopes).toBeUndefined()
  })
})

describe('l entrée par Google', () => {
  const JETONS = {
    provider: 'google',
    access_token: 'jeton-acces',
    refresh_token: 'jeton-rafraichissement',
    expires_at: 1_755_860_400,
    scope: 'https://www.googleapis.com/auth/calendar',
  }
  const PROFIL = { email: 'entree@test.local', email_verified: true, name: 'Entrée' }

  async function entrer(p: {
    account?: Record<string, unknown>
    profile?: Record<string, unknown>
    user: Record<string, unknown>
  }) {
    return (await construireConfig()).callbacks.signIn(p)
  }

  beforeEach(() => {
    lireClientMock.mockResolvedValue(null)
    lierMock.mockReset()
    enregistrerMock.mockReset().mockResolvedValue({ calendarId: 'agenda' })
  })

  // La porte mot de passe n'a rien à voir avec la fusion : son `authorize` a
  // déjà tranché, et repasser par ici ne ferait que risquer de le défaire.
  it('laisse passer la connexion par mot de passe sans y toucher', async () => {
    const user = { id: 'venu-de-authorize' }

    expect(await entrer({ account: { provider: 'credentials' }, user })).toBe(true)
    expect(lierMock).not.toHaveBeenCalled()
    expect(user.id).toBe('venu-de-authorize')
  })

  // Adresse non vérifiée, compte désactivé : la fusion rend `null`, et un
  // `null` ne rentre pas. Sans ce refus, un compte coupé rouvrirait sa session
  // par Google, et une adresse déclarée sans preuve prendrait le compte d'un
  // autre.
  it('refuse ce que la fusion refuse', async () => {
    lierMock.mockResolvedValue(null)
    const user = { id: 'identifiant-google' }

    expect(await entrer({ account: JETONS, profile: PROFIL, user })).toBe(false)
    expect(enregistrerMock).not.toHaveBeenCalled()
  })

  // Le jeton de session doit porter **notre** identifiant : tout le reste de
  // l'application lit `User.id`, et un identifiant Google y ferait échouer la
  // première écriture touchant une clé étrangère.
  it('substitue notre identifiant et notre rôle à ceux de Google', async () => {
    lierMock.mockResolvedValue({ id: 'notre-identifiant', role: 'CONSULTANT' })
    const user: { id: string; role?: string } = { id: 'identifiant-google' }

    expect(await entrer({ account: JETONS, profile: PROFIL, user })).toBe(true)
    expect(user.id).toBe('notre-identifiant')
    expect(user.role).toBe('CONSULTANT')
  })

  it('confie le jeton d agenda au connecteur, sous notre identifiant', async () => {
    lierMock.mockResolvedValue({ id: 'notre-identifiant', role: 'CONSULTANT' })

    await entrer({ account: JETONS, profile: PROFIL, user: { id: 'identifiant-google' } })

    expect(enregistrerMock).toHaveBeenCalledWith({
      userId: 'notre-identifiant',
      jetons: {
        accessToken: 'jeton-acces',
        refreshToken: 'jeton-rafraichissement',
        expiresAt: new Date(1_755_860_400_000),
        scope: 'https://www.googleapis.com/auth/calendar',
      },
    })
  })

  // Entrer pour saisir ses temps ne dépend pas de la santé de l'API Calendar :
  // l'enregistrement s'annule tout seul, Synchro affiche « non connecté », et
  // son bouton répare. Bloquer l'entrée ferait d'une panne d'agenda une panne
  // de connexion.
  it("n'interdit pas l'entrée quand l'agenda échoue", async () => {
    lierMock.mockResolvedValue({ id: 'notre-identifiant', role: 'CONSULTANT' })
    enregistrerMock.mockRejectedValue(new Error('calendrier indisponible'))

    expect(await entrer({ account: JETONS, profile: PROFIL, user: { id: 'g' } })).toBe(true)
  })

  // Google omet le jeton de rafraîchissement quand le compte a déjà consenti.
  // Enregistrer un accès sans lui produirait une connexion morte une heure
  // plus tard, sans explication possible.
  it("n'enregistre rien quand le consentement ne rapporte pas de rafraîchissement", async () => {
    lierMock.mockResolvedValue({ id: 'notre-identifiant', role: 'CONSULTANT' })
    const { refresh_token: _, ...sansRafraichissement } = JETONS

    expect(await entrer({ account: sansRafraichissement, profile: PROFIL, user: { id: 'g' } })).toBe(
      true,
    )
    expect(enregistrerMock).not.toHaveBeenCalled()
  })
})
