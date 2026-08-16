import { prisma } from '@/db/client'
import { decryptSecret, encryptSecret, parseKey, SecretBoxError } from '@/core/crypto/secret-box'
import { journalAvertissement } from '@/services/log'

export interface ProviderTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scope: string
  calendarId: string
}

/**
 * Vue sans secret d'un identifiant d'instance. C'est le type que les pages et
 * les actions manipulent : il ne porte aucun scellé, donc il ne peut pas
 * laisser fuir une clé d'API dans un rendu ou un journal.
 */
export interface InstanceCredentialView {
  provider: string
  baseUrl: string
  metadata: Record<string, string>
  connectedAt: Date
}

/**
 * Les deux natures de propriétaire. `ownerScope` entre dans la contrainte
 * d'unicité de `ProviderCredential` : c'est lui, et non un `userId` nullable,
 * qui laisse cohabiter une clé d'API d'instance et des jetons personnels sans
 * que la contrainte cesse de contraindre (voir le commentaire du modèle).
 */
export const OWNER_SCOPE_USER = 'USER'
export const OWNER_SCOPE_INSTANCE = 'INSTANCE'

/**
 * Le `userId` d'une ligne d'instance : la chaîne vide, jamais NULL. Deux NULL
 * ne sont pas égaux en SQL — deux clés d'instance du même fournisseur auraient
 * donc coexisté, et rien ne l'aurait signalé.
 */
const INSTANCE_USER_ID = ''

/**
 * La clé vient de l'environnement, jamais de la base : une base volée sans la
 * variable d'environnement ne donne accès à aucun agenda.
 *
 * L'absence lève, délibérément : une version antérieure retombait sur une clé
 * par défaut et posait en base des jetons chiffrés avec une clé publique. La
 * levée porte une `SecretBoxError` — le même type que les autres défauts de
 * clé — pour que l'appelant puisse distinguer « ce serveur est mal configuré »
 * de « Google a refusé », et le dire au lieu de conseiller de réessayer.
 */
function credentialsKey(): Buffer {
  const raw = process.env.CREDENTIALS_KEY ?? ''
  if (raw === '') {
    throw new SecretBoxError(
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
    where: { ownerScope_userId_provider: { ownerScope: OWNER_SCOPE_USER, userId, provider } },
    create: { ownerScope: OWNER_SCOPE_USER, userId, provider, ...data },
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
    where: { ownerScope_userId_provider: { ownerScope: OWNER_SCOPE_USER, userId, provider } },
  })
  if (row === null) return null

  try {
    const key = credentialsKey()
    return {
      accessToken: decryptSecret(row.accessTokenEnc, key),
      refreshToken: decryptSecret(row.refreshTokenEnc, key),
      // `expiresAt` est nullable depuis que la table accueille aussi des clés
      // d'API sans échéance. Un jeton personnel en porte toujours une ; une
      // absence ici ne peut venir que d'une ligne écrite hors du chemin OAuth,
      // et l'époque la fait lire comme expirée — le connecteur rafraîchira,
      // quitte à échouer franchement, plutôt que de s'en servir telle quelle.
      expiresAt: row.expiresAt ?? new Date(0),
      scope: row.scope,
      calendarId: row.calendarId,
    }
  } catch (err) {
    // Le `null` reste le contrat — l'application continue sans agenda — mais
    // il ne doit plus être muet : « jamais connecté » et « clé perdue »
    // produisent le même écran, et seule cette ligne les sépare.
    journalAvertissement('credentials.lecture', {
      userId,
      provider,
      raison: err instanceof Error ? err.message : String(err),
    })
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
    where: { ownerScope_userId_provider: { ownerScope: OWNER_SCOPE_USER, userId, provider } },
    data: { accessTokenEnc: encryptSecret(accessToken, credentialsKey()), expiresAt },
  })
}

export async function setCalendarId(
  userId: string,
  provider: string,
  calendarId: string,
): Promise<void> {
  await prisma.providerCredential.update({
    where: { ownerScope_userId_provider: { ownerScope: OWNER_SCOPE_USER, userId, provider } },
    data: { calendarId },
  })
}

export async function revokeCredential(userId: string, provider: string): Promise<void> {
  await prisma.providerCredential.deleteMany({
    where: { ownerScope: OWNER_SCOPE_USER, userId, provider },
  })
}

// ---------------------------------------------------------------------------
// Identifiants d'instance
//
// Une clé d'API Dolibarr appartient à l'instance, pas à une personne : elle est
// saisie une fois par l'exploitant et vaut pour tous. Les quatre fonctions qui
// suivent ne prennent donc PAS de `userId` — comme `getSettings` /
// `updateSettings`, qui règlent la même sorte d'objet. Un paramètre `userId`
// décoratif serait pire que son absence : il ressemblerait à un cloisonnement
// là où il n'y a rien à cloisonner. Le contrôle d'accès à ces écrans reste la
// responsabilité de l'appelant.
//
// Ce qu'elles cloisonnent en revanche, strictement, c'est la portée : une
// lecture d'instance ne voit jamais un jeton personnel, et réciproquement.
// ---------------------------------------------------------------------------

/** Le JSON des métadonnées, réduit à un objet plat de chaînes. */
function parseMetadata(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  } catch {
    // Un JSON illisible ne doit pas rendre le fournisseur inutilisable : les
    // métadonnées sont un contexte, jamais la condition de la connexion.
    return {}
  }
}

export async function saveInstanceCredential(args: {
  provider: string
  secret: string
  baseUrl?: string
  metadata?: Record<string, string>
}): Promise<void> {
  // Lue avant toute écriture, et jamais remplacée par un défaut : sans clé,
  // l'enregistrement échoue franchement au lieu de poser en base une clé d'API
  // « chiffrée » avec un secret que tout le monde connaît.
  const key = credentialsKey()
  const data = {
    accessTokenEnc: encryptSecret(args.secret, key),
    // Dolibarr n'a pas de secret de renouvellement ; le scellé d'une chaîne
    // vide garde la colonne homogène et déchiffrable comme les autres.
    refreshTokenEnc: encryptSecret('', key),
    expiresAt: null,
    baseUrl: args.baseUrl ?? '',
    metadataJson: JSON.stringify(args.metadata ?? {}),
  }

  await prisma.providerCredential.upsert({
    where: {
      ownerScope_userId_provider: {
        ownerScope: OWNER_SCOPE_INSTANCE,
        userId: INSTANCE_USER_ID,
        provider: args.provider,
      },
    },
    create: {
      ownerScope: OWNER_SCOPE_INSTANCE,
      userId: INSTANCE_USER_ID,
      provider: args.provider,
      ...data,
    },
    update: data,
  })
}

/** Vue sans secret : c'est ce qu'un écran d'administration a le droit de voir. */
export async function getInstanceCredential(
  provider: string,
): Promise<InstanceCredentialView | null> {
  const row = await prisma.providerCredential.findUnique({
    where: {
      ownerScope_userId_provider: {
        ownerScope: OWNER_SCOPE_INSTANCE,
        userId: INSTANCE_USER_ID,
        provider,
      },
    },
  })
  if (row === null) return null

  return {
    provider: row.provider,
    baseUrl: row.baseUrl,
    metadata: parseMetadata(row.metadataJson),
    connectedAt: row.connectedAt,
  }
}

/**
 * Déscelle la clé d'API. Réservé aux appelants qui vont réellement parler au
 * fournisseur — jamais appelé depuis une page ou un composant.
 *
 * Même contrat de dégradation que `getCredential` : `null` couvre « jamais
 * configuré » et « clé de chiffrement perdue », l'application continue sans
 * Dolibarr, et le second cas laisse une ligne de journal — sans quoi rien au
 * monde ne les sépare.
 */
export async function readInstanceSecret(provider: string): Promise<string | null> {
  const row = await prisma.providerCredential.findUnique({
    where: {
      ownerScope_userId_provider: {
        ownerScope: OWNER_SCOPE_INSTANCE,
        userId: INSTANCE_USER_ID,
        provider,
      },
    },
  })
  if (row === null) return null

  try {
    return decryptSecret(row.accessTokenEnc, credentialsKey())
  } catch (err) {
    journalAvertissement('credentials.lecture', {
      provider,
      raison: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export async function revokeInstanceCredential(provider: string): Promise<void> {
  await prisma.providerCredential.deleteMany({
    where: { ownerScope: OWNER_SCOPE_INSTANCE, userId: INSTANCE_USER_ID, provider },
  })
}
