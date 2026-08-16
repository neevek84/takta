import { prisma } from '@/db/client'
import { decryptSecret, encryptSecret, parseKey } from '@/core/crypto/secret-box'

export interface ProviderTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scope: string
  calendarId: string
}

/**
 * La clé vient de l'environnement, jamais de la base : une base volée sans la
 * variable d'environnement ne donne accès à aucun agenda.
 */
function credentialsKey(): Buffer {
  const raw = process.env.CREDENTIALS_KEY ?? ''
  if (raw === '') {
    throw new Error(
      "CREDENTIALS_KEY est absente de l'environnement : les jetons ne peuvent être ni chiffrés ni relus.",
    )
  }
  return parseKey(raw)
}

export async function saveCredential(
  userId: string,
  provider: string,
  tokens: ProviderTokens,
): Promise<void> {
  const key = credentialsKey()
  const data = {
    accessTokenEnc: encryptSecret(tokens.accessToken, key),
    refreshTokenEnc: encryptSecret(tokens.refreshToken, key),
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    calendarId: tokens.calendarId,
  }

  await prisma.providerCredential.upsert({
    where: { userId_provider: { userId, provider } },
    create: { userId, provider, ...data },
    update: data,
  })
}

/**
 * `null` couvre trois cas volontairement indistincts pour l'appelant : compte
 * jamais connecté, connexion révoquée, et clé perdue ou changée. Dans les
 * trois, la conduite à tenir est la même — reconnecter le compte — et surtout
 * l'application continue de fonctionner sans agenda.
 */
export async function getCredential(
  userId: string,
  provider: string,
): Promise<ProviderTokens | null> {
  const row = await prisma.providerCredential.findUnique({
    where: { userId_provider: { userId, provider } },
  })
  if (row === null) return null

  try {
    const key = credentialsKey()
    return {
      accessToken: decryptSecret(row.accessTokenEnc, key),
      refreshToken: decryptSecret(row.refreshTokenEnc, key),
      expiresAt: row.expiresAt,
      scope: row.scope,
      calendarId: row.calendarId,
    }
  } catch {
    return null
  }
}

export async function updateAccessToken(
  userId: string,
  provider: string,
  accessToken: string,
  expiresAt: Date,
): Promise<void> {
  await prisma.providerCredential.update({
    where: { userId_provider: { userId, provider } },
    data: { accessTokenEnc: encryptSecret(accessToken, credentialsKey()), expiresAt },
  })
}

export async function setCalendarId(
  userId: string,
  provider: string,
  calendarId: string,
): Promise<void> {
  await prisma.providerCredential.update({
    where: { userId_provider: { userId, provider } },
    data: { calendarId },
  })
}

export async function revokeCredential(userId: string, provider: string): Promise<void> {
  await prisma.providerCredential.deleteMany({ where: { userId, provider } })
}
