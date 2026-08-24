import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { SecretBoxError } from '@/core/crypto/secret-box'
import { PROVIDER_GOOGLE } from '@/core/sync/policy'
import { OWNER_SCOPE_INSTANCE, saveCredential } from '@/services/credentials'
import {
  saveGoogleOAuthClient,
  getGoogleOAuthClientView,
  readGoogleOAuthClient,
  forgetGoogleOAuthClient,
} from './oauth-client'

const CLIENT = {
  clientId: '1234.apps.googleusercontent.com',
  clientSecret: 'GOCSPX-le-secret-du-client',
  redirectUri: 'http://localhost:3000/api/google/callback',
}

let cleValide = ''
let userId = ''

beforeAll(async () => {
  cleValide = randomBytes(32).toString('base64')
  const u = await prisma.user.create({
    data: { email: 'google-client@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
})

beforeEach(async () => {
  process.env.CREDENTIALS_KEY = cleValide
  delete process.env.GOOGLE_CLIENT_ID
  delete process.env.GOOGLE_CLIENT_SECRET
  delete process.env.GOOGLE_REDIRECT_URI
  await prisma.providerCredential.deleteMany({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'google-client@test.local' } })
  await prisma.$disconnect()
})

describe('le client OAuth Google vit en base, pas dans un fichier', () => {
  it('rend le client après un aller-retour', async () => {
    await saveGoogleOAuthClient(CLIENT)
    expect(await readGoogleOAuthClient()).toEqual(CLIENT)
  })

  it('ne stocke jamais le secret du client en clair', async () => {
    // La promesse de tout ce déplacement : dans un fichier, un secret se lit ;
    // en base, il est scellé par une clé qui vit ailleurs.
    await saveGoogleOAuthClient(CLIENT)

    const row = await prisma.providerCredential.findFirstOrThrow({
      where: { ownerScope: OWNER_SCOPE_INSTANCE, provider: PROVIDER_GOOGLE },
    })
    const toutesLesColonnes = JSON.stringify(row)
    expect(toutesLesColonnes).not.toContain(CLIENT.clientSecret)
    expect(toutesLesColonnes).not.toContain('GOCSPX')
  })

  it('rend le secret illisible sans la clé de chiffrement', async () => {
    await saveGoogleOAuthClient(CLIENT)

    // Même base, autre clé : c'est le scénario de la base volée seule.
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
    expect(await readGoogleOAuthClient()).toBeNull()
  })

  it('refuse d enregistrer sans clé de chiffrement, au lieu de poser un faux scellé', async () => {
    delete process.env.CREDENTIALS_KEY
    await expect(saveGoogleOAuthClient(CLIENT)).rejects.toBeInstanceOf(SecretBoxError)
    expect(await prisma.providerCredential.count()).toBe(0)
  })

  it('remplace le client d une seconde saisie sans créer de seconde ligne', async () => {
    // Un client OAuth par instance : la spec §8 le tranche, et deux lignes
    // rendraient la lecture dépendante de l'ordre d'insertion.
    await saveGoogleOAuthClient(CLIENT)
    await saveGoogleOAuthClient({ ...CLIENT, clientId: 'autre.apps.googleusercontent.com' })

    expect(
      await prisma.providerCredential.count({
        where: { ownerScope: OWNER_SCOPE_INSTANCE, provider: PROVIDER_GOOGLE },
      }),
    ).toBe(1)
    expect((await readGoogleOAuthClient())?.clientId).toBe('autre.apps.googleusercontent.com')
  })

  it('ne se mélange jamais avec les jetons personnels du même fournisseur', async () => {
    // Les deux vivent dans `ProviderCredential` sous le même `provider` : seul
    // `ownerScope` les sépare. Une lecture qui l'oublierait rendrait le jeton
    // d'accès de quelqu'un comme secret de client.
    await saveCredential(userId, PROVIDER_GOOGLE, {
      accessToken: 'ya29.acces',
      refreshToken: '1//rafraichissement',
      expiresAt: new Date('2026-08-15T12:00:00.000Z'),
      scope: 'https://www.googleapis.com/auth/calendar',
      calendarId: 'cra@group.calendar.google.com',
      ownerEmail: 'compte@exemple.test',
    })
    await saveGoogleOAuthClient(CLIENT)

    expect(await readGoogleOAuthClient()).toEqual(CLIENT)
    expect(await prisma.providerCredential.count()).toBe(2)
  })

  it('oublie le client sans toucher aux jetons personnels', async () => {
    await saveCredential(userId, PROVIDER_GOOGLE, {
      accessToken: 'ya29.acces',
      refreshToken: '1//rafraichissement',
      expiresAt: new Date('2026-08-15T12:00:00.000Z'),
      scope: 'calendar',
      calendarId: 'cra@group.calendar.google.com',
      ownerEmail: 'compte@exemple.test',
    })
    await saveGoogleOAuthClient(CLIENT)

    await forgetGoogleOAuthClient()

    expect(await readGoogleOAuthClient()).toBeNull()
    expect(await prisma.providerCredential.count()).toBe(1)
  })

  it('rend null quand rien n a jamais été configuré', async () => {
    expect(await readGoogleOAuthClient()).toBeNull()
    expect(await getGoogleOAuthClientView()).toBeNull()
  })
})

describe("l'environnement n'est plus une source", () => {
  it('ne retombe jamais sur les variables d environnement', async () => {
    // Le cœur de la spec : une valeur que l'utilisateur tape ne vit pas dans un
    // fichier. Un repli sur l'environnement ferait fonctionner l'écran « par
    // hasard » sur les postes qui ont gardé leur ancien `.env`, et le
    // déplacement ne serait jamais terminé nulle part.
    process.env.GOOGLE_CLIENT_ID = 'venu-du-fichier.apps.googleusercontent.com'
    process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-venu-du-fichier'
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/api/google/callback'

    expect(await readGoogleOAuthClient()).toBeNull()
    expect(await getGoogleOAuthClientView()).toBeNull()
  })

  it('ne complète pas un client enregistré avec des valeurs d environnement', async () => {
    process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-venu-du-fichier'
    await saveGoogleOAuthClient(CLIENT)

    expect((await readGoogleOAuthClient())?.clientSecret).toBe(CLIENT.clientSecret)
  })
})

describe('la vue rendue aux écrans', () => {
  it('porte l identifiant et l URL de retour, jamais le secret', async () => {
    await saveGoogleOAuthClient(CLIENT)
    const vue = await getGoogleOAuthClientView()

    expect(vue?.clientId).toBe(CLIENT.clientId)
    expect(vue?.redirectUri).toBe(CLIENT.redirectUri)
    expect(JSON.stringify(vue)).not.toContain(CLIENT.clientSecret)
    // Structurel, pas déclaratif : le type ne porte aucun champ de secret.
    expect(Object.keys(vue ?? {})).not.toContain('clientSecret')
  })

  it('reste disponible même si la clé de chiffrement a changé', async () => {
    // Le secret devient illisible, mais l'écran doit continuer à dire ce qui
    // est configuré — sinon « jamais configuré » et « clé perdue » produisent
    // le même écran et personne ne peut diagnostiquer.
    await saveGoogleOAuthClient(CLIENT)
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

    expect((await getGoogleOAuthClientView())?.clientId).toBe(CLIENT.clientId)
  })

  it('laisse une trace au journal quand le secret est devenu illisible', async () => {
    const lignes: string[] = []
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      lignes.push(a.map(String).join(' '))
    })

    await saveGoogleOAuthClient(CLIENT)
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
    await readGoogleOAuthClient()

    expect(lignes.join('\n')).toContain('credentials.lecture')
    expect(lignes.join('\n')).not.toContain(CLIENT.clientSecret)
  })
})
