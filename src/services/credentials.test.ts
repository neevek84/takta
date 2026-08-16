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
