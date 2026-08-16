import { PROVIDER_GOOGLE } from '@/core/sync/policy'
import { confierSecret } from '@/services/log'
import type { GoogleOAuthClient } from '@/core/google/oauth-client'
import {
  getInstanceCredential,
  readInstanceSecret,
  revokeInstanceCredential,
  saveInstanceCredential,
} from '@/services/credentials'

/**
 * Le client OAuth Google de l'instance : saisi à l'écran, chiffré au repos,
 * jamais relu depuis un fichier d'environnement.
 *
 * Le mécanisme est **exactement** celui de la clé d'API Dolibarr — portée
 * instance dans `ProviderCredential`, secret scellé par `CREDENTIALS_KEY`,
 * métadonnées en clair. Rien n'est réinventé ici : ce module ne fait que
 * nommer, pour Google, les quatre fonctions d'instance de
 * `services/credentials.ts`.
 *
 * Le fournisseur est le même que celui des jetons personnels (`GOOGLE`) :
 * c'est `ownerScope` qui sépare « le client de l'instance » de « les jetons de
 * cette personne », et c'est précisément ce pour quoi il existe.
 */

/** Ce qu'un écran a le droit de voir : tout sauf le secret. */
export interface GoogleOAuthClientView {
  clientId: string
  redirectUri: string
  /** date d'enregistrement, pour que l'écran puisse dire depuis quand. */
  configuredAt: Date
}

const CLE_CLIENT_ID = 'clientId'
const CLE_REDIRECT_URI = 'redirectUri'

/**
 * Enregistre le client. Lève si `CREDENTIALS_KEY` est absente — c'est
 * `saveInstanceCredential` qui le fait, et il ne faut surtout pas l'adoucir :
 * un secret « chiffré » avec une clé par défaut est pire qu'un secret en clair,
 * parce qu'il en a l'air.
 */
export async function saveGoogleOAuthClient(client: GoogleOAuthClient): Promise<void> {
  await saveInstanceCredential({
    provider: PROVIDER_GOOGLE,
    secret: client.clientSecret,
    metadata: {
      [CLE_CLIENT_ID]: client.clientId,
      [CLE_REDIRECT_URI]: client.redirectUri,
    },
  })
}

/**
 * La vue sans secret. Reste disponible même quand le secret est devenu
 * illisible : « jamais configuré » et « clé de chiffrement changée » ne
 * doivent pas produire le même écran.
 */
export async function getGoogleOAuthClientView(): Promise<GoogleOAuthClientView | null> {
  const row = await getInstanceCredential(PROVIDER_GOOGLE)
  if (row === null) return null

  return {
    clientId: row.metadata[CLE_CLIENT_ID] ?? '',
    redirectUri: row.metadata[CLE_REDIRECT_URI] ?? '',
    configuredAt: row.connectedAt,
  }
}

/**
 * Le client complet, secret compris. Réservé aux appelants qui vont réellement
 * parler à Google — jamais appelé depuis une page ni un composant.
 *
 * `null` couvre « jamais configuré » et « secret illisible », comme partout
 * ailleurs : l'application continue sans agenda, ce qui est un état légitime.
 * Ce qu'il ne fait **jamais**, c'est retomber sur `process.env` : une valeur
 * que l'utilisateur tape ne vit plus dans un fichier, et un repli discret
 * ferait fonctionner l'écran par accident là où un ancien `.env` traîne.
 */
export async function readGoogleOAuthClient(): Promise<GoogleOAuthClient | null> {
  const vue = await getGoogleOAuthClientView()
  if (vue === null) return null

  const clientSecret = await readInstanceSecret(PROVIDER_GOOGLE)
  if (clientSecret === null || clientSecret === '') return null
  if (vue.clientId === '' || vue.redirectUri === '') return null

  // Le secret ne vit plus dans l'environnement, donc la liste des variables
  // secrètes du journal ne le couvre plus — et rien d'autre ne le couvrait :
  // recopié dans un message de refus de Google, il n'a ni la forme d'une paire
  // nommée ni forcément celle d'une chaîne opaque, qui exige des chiffres. On
  // le confie au journal au moment même où on le lit.
  confierSecret(clientSecret)

  return { clientId: vue.clientId, clientSecret, redirectUri: vue.redirectUri }
}

/**
 * Efface le client de l'instance. Les jetons personnels déjà obtenus restent :
 * ils appartiennent à des comptes, pas au client, et les effacer ici
 * déconnecterait tout le monde pour une correction de saisie.
 */
export async function forgetGoogleOAuthClient(): Promise<void> {
  await revokeInstanceCredential(PROVIDER_GOOGLE)
}
