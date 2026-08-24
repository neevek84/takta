import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/db/client'
import { SecretBoxError } from '@/core/crypto/secret-box'
import {
  saveCredential,
  getCredential,
  updateAccessToken,
  setCalendarId,
  revokeCredential,
  aUnConnecteurAgenda,
  saveInstanceCredential,
  getInstanceCredential,
  readInstanceSecret,
  revokeInstanceCredential,
} from './credentials'

let userId = ''
let autreId = ''

const TOKENS = {
  accessToken: 'ya29.acces',
  refreshToken: '1//rafraichissement',
  expiresAt: new Date('2026-08-15T12:00:00.000Z'),
  scope: 'https://www.googleapis.com/auth/calendar',
  calendarId: 'cra@group.calendar.google.com',
}

beforeAll(async () => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
  const u = await prisma.user.create({
    data: { email: 'creds@test.local', name: 'T', passwordHash: 'x' },
  })
  userId = u.id
  const a = await prisma.user.create({
    data: { email: 'creds-autre@test.local', name: 'A', passwordHash: 'x' },
  })
  autreId = a.id
})

beforeEach(async () => {
  await prisma.providerCredential.deleteMany({})
})

afterAll(async () => {
  await prisma.providerCredential.deleteMany({})
  await prisma.user.deleteMany({
    where: { email: { in: ['creds@test.local', 'creds-autre@test.local'] } },
  })
  await prisma.$disconnect()
})

describe('credentials', () => {
  it('rend les jetons après un aller-retour', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    expect(await getCredential(userId, 'GOOGLE')).toEqual(TOKENS)
  })

  it('ne stocke jamais un jeton en clair', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    const row = await prisma.providerCredential.findFirstOrThrow({ where: { userId } })
    expect(row.accessTokenEnc).not.toContain('ya29')
    expect(row.refreshTokenEnc).not.toContain('rafraichissement')
  })

  it('remplace les jetons d une reconnexion sans créer de seconde ligne', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    await saveCredential(userId, 'GOOGLE', { ...TOKENS, accessToken: 'ya29.nouveau' })

    expect(await prisma.providerCredential.count({ where: { userId } })).toBe(1)
    expect((await getCredential(userId, 'GOOGLE'))?.accessToken).toBe('ya29.nouveau')
  })

  it('renvoie null quand le compte n est pas connecté', async () => {
    expect(await getCredential(userId, 'GOOGLE')).toBeNull()
  })

  it('ne laisse pas voir les jetons d un autre utilisateur', async () => {
    await saveCredential(autreId, 'GOOGLE', TOKENS)
    expect(await getCredential(userId, 'GOOGLE')).toBeNull()
  })

  it('rafraîchit le seul jeton d accès', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    const expire = new Date('2026-08-15T13:00:00.000Z')
    await updateAccessToken(userId, 'GOOGLE', 'ya29.rafraichi', expire)

    const relu = await getCredential(userId, 'GOOGLE')
    expect(relu?.accessToken).toBe('ya29.rafraichi')
    expect(relu?.expiresAt).toEqual(expire)
    // Le jeton de rafraîchissement, lui, ne bouge pas.
    expect(relu?.refreshToken).toBe(TOKENS.refreshToken)
  })

  it('enregistre le calendrier dédié', async () => {
    await saveCredential(userId, 'GOOGLE', { ...TOKENS, calendarId: '' })
    await setCalendarId(userId, 'GOOGLE', 'dedie@group.calendar.google.com')
    expect((await getCredential(userId, 'GOOGLE'))?.calendarId).toBe(
      'dedie@group.calendar.google.com',
    )
  })

  it('révoque la connexion', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    await revokeCredential(userId, 'GOOGLE')
    expect(await getCredential(userId, 'GOOGLE')).toBeNull()
  })

  // Hors brief : `revokeCredential` passe par `deleteMany`, où rien dans le
  // typage n'exige le `userId`. Retirer ce filtre déconnectait tout le monde
  // sans faire tomber un seul des dix tests du brief.
  it('ne révoque que la connexion de l utilisateur visé', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    await saveCredential(autreId, 'GOOGLE', TOKENS)

    await revokeCredential(userId, 'GOOGLE')

    expect(await getCredential(userId, 'GOOGLE')).toBeNull()
    expect(await getCredential(autreId, 'GOOGLE')).not.toBeNull()
  })

  // La spec le dit : perdre la clé impose de reconnecter le compte. Ce que ça
  // ne doit surtout pas faire, c'est casser l'application.
  it('se lit comme non connecté quand la clé a changé', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    const ancienne = process.env.CREDENTIALS_KEY
    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')

    expect(await getCredential(userId, 'GOOGLE')).toBeNull()

    process.env.CREDENTIALS_KEY = ancienne
  })

  it('se lit comme non connecté quand la clé est absente', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    const ancienne = process.env.CREDENTIALS_KEY
    delete process.env.CREDENTIALS_KEY

    expect(await getCredential(userId, 'GOOGLE')).toBeNull()

    process.env.CREDENTIALS_KEY = ancienne
  })

  it('dégrade en silence pour l utilisateur, jamais pour l exploitant', async () => {
    // « Jamais connecté » et « clé perdue » produisent le même `null` et le
    // même écran. Sans cette ligne de journal, rien au monde ne les sépare.
    await saveCredential(userId, 'GOOGLE', TOKENS)
    const ancienne = process.env.CREDENTIALS_KEY
    const journal: string[] = []
    const espion = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      journal.push(a.map(String).join(' '))
    })

    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
    expect(await getCredential(userId, 'GOOGLE')).toBeNull()
    process.env.CREDENTIALS_KEY = ancienne

    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('credentials.lecture')
    expect(journal[0]).toContain(`userId=${userId}`)
    expect(journal[0]).toContain('déchiffré')
    // Le jeton en clair ne sort jamais, même sur le chemin de l'échec.
    expect(journal[0]).not.toContain(TOKENS.accessToken)
    expect(journal[0]).not.toContain(TOKENS.refreshToken)
    espion.mockRestore()
  })

  it('ne journalise rien pour un compte simplement pas connecté', async () => {
    // L'état par défaut de toute installation : il ne doit pas remplir les
    // journaux à chaque ouverture d'un mois.
    const journal: string[] = []
    const espion = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      journal.push(a.map(String).join(' '))
    })

    expect(await getCredential(userId, 'GOOGLE')).toBeNull()

    expect(journal).toEqual([])
    espion.mockRestore()
  })

  // Hors brief, et c'est le test qui compte le plus ici. La lecture dégrade en
  // silence — c'est voulu — mais l'écriture, elle, doit refuser franchement :
  // sans clé, faire retomber le chiffrement sur une valeur par défaut poserait
  // en base des jetons « chiffrés » avec une clé que tout le monde connaît, et
  // rien ne le signalerait. Les dix tests du brief laissaient passer cela.
  it("refuse d'enregistrer des jetons quand la clé est absente", async () => {
    const ancienne = process.env.CREDENTIALS_KEY
    delete process.env.CREDENTIALS_KEY

    // Le type compte autant que le message : c'est lui qui permet au retour de
    // consentement de dire « ce serveur est mal configuré » au lieu de
    // « Réessayez », pour une opération qui ne peut jamais aboutir.
    await expect(saveCredential(userId, 'GOOGLE', TOKENS)).rejects.toThrow(SecretBoxError)
    await expect(saveCredential(userId, 'GOOGLE', TOKENS)).rejects.toThrow(/CREDENTIALS_KEY/)
    expect(await prisma.providerCredential.count({})).toBe(0)

    process.env.CREDENTIALS_KEY = ancienne
  })

  it("refuse d'enregistrer des jetons quand la clé n'est pas du base64 valide", async () => {
    const ancienne = process.env.CREDENTIALS_KEY
    process.env.CREDENTIALS_KEY = 'motdepasse treslong quiressemble aunecle AAAAAA'

    await expect(saveCredential(userId, 'GOOGLE', TOKENS)).rejects.toThrow(SecretBoxError)
    expect(await prisma.providerCredential.count({})).toBe(0)

    process.env.CREDENTIALS_KEY = ancienne
  })

  it("refuse d'enregistrer des jetons quand la clé n'a pas la bonne taille", async () => {
    const ancienne = process.env.CREDENTIALS_KEY
    process.env.CREDENTIALS_KEY = randomBytes(16).toString('base64')

    await expect(saveCredential(userId, 'GOOGLE', TOKENS)).rejects.toThrow(SecretBoxError)
    expect(await prisma.providerCredential.count({})).toBe(0)

    process.env.CREDENTIALS_KEY = ancienne
  })
})

/**
 * Tâche 11 — la lecture locale dont `page.tsx` se sert pour savoir si un
 * bouton « Vérifier l'agenda » a quelque chose à vérifier, sans jamais parler
 * au réseau.
 */
describe('aUnConnecteurAgenda', () => {
  it('rend faux quand le compte n est pas connecté', async () => {
    expect(await aUnConnecteurAgenda(userId)).toBe(false)
  })

  it('rend vrai quand un calendrier est enregistré', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    expect(await aUnConnecteurAgenda(userId)).toBe(true)
  })

  // Jetons présents, agenda absent : rien ne partira jamais (voir
  // `resolveConnector`), et ce bouton ne doit pas prétendre le contraire.
  it('rend faux quand les jetons existent sans calendrier choisi', async () => {
    await saveCredential(userId, 'GOOGLE', { ...TOKENS, calendarId: '' })
    expect(await aUnConnecteurAgenda(userId)).toBe(false)
  })

  it('ne lit pas la connexion d un autre utilisateur', async () => {
    await saveCredential(autreId, 'GOOGLE', TOKENS)
    expect(await aUnConnecteurAgenda(userId)).toBe(false)
  })
})

// Une clé d'API Dolibarr appartient à l'instance, pas à une personne : elle
// est saisie une fois par l'exploitant et vaut pour tous. Elle partage
// néanmoins la table, le chiffrement et le contrat de dégradation des jetons
// personnels — un seul endroit sait déchiffrer, un seul endroit peut fuir.
describe('identifiants d instance', () => {
  // Valeur manifestement factice : rien de ce fichier ne doit ressembler à une
  // vraie clé d'API.
  const CLE_API = 'DOLAPIKEY-factice-0000'

  it('stocke la clé chiffrée, jamais en clair', async () => {
    await saveInstanceCredential({
      provider: 'DOLIBARR',
      secret: CLE_API,
      baseUrl: 'https://erp.exemple.test',
    })

    const row = await prisma.providerCredential.findFirstOrThrow({
      where: { provider: 'DOLIBARR' },
    })
    expect(row.accessTokenEnc).not.toContain(CLE_API)
    expect(row.accessTokenEnc.startsWith('v1.')).toBe(true)
    // La portée est ce qui rend la contrainte d'unicité effective : une clé
    // d'instance rangée en portée personnelle se dupliquerait par utilisateur.
    expect({ ownerScope: row.ownerScope, userId: row.userId }).toEqual({
      ownerScope: 'INSTANCE',
      userId: '',
    })
  })

  it('rend la clé à la lecture', async () => {
    await saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API })
    expect(await readInstanceSecret('DOLIBARR')).toBe(CLE_API)
  })

  it('n expose aucun secret dans la vue', async () => {
    await saveInstanceCredential({
      provider: 'DOLIBARR',
      secret: CLE_API,
      baseUrl: 'https://erp.exemple.test',
      metadata: { dolibarrUserId: '7' },
    })

    const vue = await getInstanceCredential('DOLIBARR')
    expect(Object.keys(vue!).sort()).toEqual(['baseUrl', 'connectedAt', 'metadata', 'provider'])
    expect(JSON.stringify(vue)).not.toContain(CLE_API)
    expect(vue!.baseUrl).toBe('https://erp.exemple.test')
    expect(vue!.metadata).toEqual({ dolibarrUserId: '7' })
  })

  it('rend des métadonnées vides plutôt que de casser sur un JSON illisible', async () => {
    await saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API })
    await prisma.providerCredential.updateMany({
      where: { provider: 'DOLIBARR' },
      data: { metadataJson: 'pas-du-json' },
    })
    expect((await getInstanceCredential('DOLIBARR'))!.metadata).toEqual({})
  })

  it('remplace la clé existante au lieu d en empiler une seconde', async () => {
    await saveInstanceCredential({ provider: 'DOLIBARR', secret: 'ancienne-factice' })
    await saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API })

    expect(await prisma.providerCredential.count({ where: { provider: 'DOLIBARR' } })).toBe(1)
    expect(await readInstanceSecret('DOLIBARR')).toBe(CLE_API)
  })

  it('rend null pour un fournisseur non configuré', async () => {
    expect(await getInstanceCredential('DOLIBARR')).toBeNull()
    expect(await readInstanceSecret('DOLIBARR')).toBeNull()
  })

  it('supprime la clé', async () => {
    await saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API })
    await revokeInstanceCredential('DOLIBARR')
    expect(await getInstanceCredential('DOLIBARR')).toBeNull()
    expect(await prisma.providerCredential.count({})).toBe(0)
  })

  // Le pendant du test qui compte le plus côté personnel : sans clé, un repli
  // sur une valeur par défaut poserait en base une clé d'API « chiffrée » avec
  // un secret que tout le monde connaît, et rien ne le signalerait.
  it("refuse d'enregistrer la clé quand CREDENTIALS_KEY est absente", async () => {
    const ancienne = process.env.CREDENTIALS_KEY
    delete process.env.CREDENTIALS_KEY

    await expect(
      saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API }),
    ).rejects.toThrow(SecretBoxError)
    await expect(
      saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API }),
    ).rejects.toThrow(/CREDENTIALS_KEY/)
    expect(await prisma.providerCredential.count({})).toBe(0)

    process.env.CREDENTIALS_KEY = ancienne
  })

  it('se lit comme non configuré quand la clé de chiffrement a changé, sans se taire', async () => {
    await saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API })
    const ancienne = process.env.CREDENTIALS_KEY
    const journal: string[] = []
    const espion = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      journal.push(a.map(String).join(' '))
    })

    process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64')
    expect(await readInstanceSecret('DOLIBARR')).toBeNull()
    process.env.CREDENTIALS_KEY = ancienne

    expect(journal).toHaveLength(1)
    expect(journal[0]).toContain('credentials.lecture')
    expect(journal[0]).toContain('provider=DOLIBARR')
    expect(journal[0]).not.toContain(CLE_API)
    espion.mockRestore()
  })

  // Les deux portées partagent la table : chacune doit être aveugle à l'autre,
  // sans quoi la clé d'instance serait rendue à qui demande son jeton
  // personnel — et réciproquement.
  it('ne rend jamais la clé d instance à une lecture personnelle', async () => {
    await saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API })
    expect(await getCredential(userId, 'DOLIBARR')).toBeNull()
  })

  // Le cas qui justifie que `ownerScope` entre dans la clé, et pas seulement
  // la sentinelle : sans lui, la ligne d'instance se lit par `('', provider)`,
  // et tout chemin appelant avec un `userId` vide — session absente, argument
  // oublié — recevrait la clé d'API de l'instance au lieu de rien.
  it('ne rend pas la clé d instance à une lecture personnelle au userId vide', async () => {
    await saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API })
    expect(await getCredential('', 'DOLIBARR')).toBeNull()
  })

  it('ne rend jamais un jeton personnel à une lecture d instance', async () => {
    await saveCredential(userId, 'GOOGLE', TOKENS)
    expect(await getInstanceCredential('GOOGLE')).toBeNull()
    expect(await readInstanceSecret('GOOGLE')).toBeNull()
  })

  it('laisse cohabiter la clé d instance et les jetons personnels', async () => {
    await saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API })
    await saveCredential(userId, 'GOOGLE', TOKENS)
    await saveCredential(autreId, 'GOOGLE', TOKENS)

    expect(await prisma.providerCredential.count({})).toBe(3)
    expect(await readInstanceSecret('DOLIBARR')).toBe(CLE_API)
    expect((await getCredential(userId, 'GOOGLE'))?.accessToken).toBe(TOKENS.accessToken)
  })

  // Révoquer la clé d'instance ne doit pas déconnecter les comptes personnels :
  // `deleteMany` accepte un filtre partiel sans que rien dans le typage ne
  // l'exige.
  it('ne révoque que la clé d instance visée', async () => {
    await saveInstanceCredential({ provider: 'DOLIBARR', secret: CLE_API })
    await saveCredential(userId, 'DOLIBARR', TOKENS)

    await revokeInstanceCredential('DOLIBARR')

    expect(await getInstanceCredential('DOLIBARR')).toBeNull()
    expect(await getCredential(userId, 'DOLIBARR')).not.toBeNull()
  })
})
