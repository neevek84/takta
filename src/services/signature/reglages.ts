import { randomBytes } from 'node:crypto'
import type { SignatureFetchLike } from '@/core/signature/connector'
import { actorOf, appendAudit } from '@/services/audit'
import {
  getInstanceCredential,
  readInstanceSecret,
  revokeInstanceCredential,
  saveInstanceCredential,
} from '@/services/credentials'
import { confierSecret } from '@/services/log'
import { readSmtpConfig } from '@/services/notify'
import { PROVIDER_DOCUMENSO } from './constants'
import { verifierDocumenso, type ResultatVerification } from './verification'

/**
 * Les réglages de la signature électronique, saisis dans Administration ·
 * Signature.
 *
 * Le mécanisme est celui de Dolibarr et de Google : un identifiant d'instance
 * dans `ProviderCredential`, secret scellé par `CREDENTIALS_KEY`. Rien n'est
 * réinventé ici ; ce module ne fait que nommer, pour Documenso, les fonctions
 * d'instance de `services/credentials.ts`.
 *
 * **Contrairement à Google, l'environnement reste un repli.** Les instances
 * installées avant cet écran se règlent par `DOCUMENSO_URL`,
 * `DOCUMENSO_API_KEY` et `SIGNATURE_WEBHOOK_SECRET` : les ignorer couperait la
 * signature à la mise à jour. Le réglage de l'écran l'emporte toujours, et
 * l'écran dit lequel des deux est en vigueur.
 *
 * Pas de `userId` pour les lectures, comme toutes les fonctions d'instance :
 * le contrôle d'accès est celui de la page et des actions. Les écritures en
 * prennent un, pour le journal — c'est un acteur, pas un cloisonnement.
 */

/**
 * Le second identifiant d'instance : le secret partagé avec le webhook. Un
 * fournisseur à part plutôt qu'une métadonnée, parce que les métadonnées sont
 * en clair et que ce secret ouvre une route qui verrouille un mois.
 */
export const PROVIDER_DOCUMENSO_WEBHOOK = 'documenso-webhook'

/** D'où vient la configuration en vigueur. */
export type Provenance = 'ecran' | 'env' | 'aucune'

export interface ConfigurationDocumenso {
  provenance: Provenance
  baseUrl: string
  apiKey: string
}

/** Ce qu'un écran a le droit de voir : tout sauf la clé et le secret. */
export interface VueReglagesSignature {
  connexion: {
    provenance: Provenance
    baseUrl: string
    enregistreLe: Date | null
    /** une ligne existe à l'écran, lisible ou non : de quoi proposer « Déconnecter » */
    ligne: boolean
    /** la ligne existe mais sa clé ne se déchiffre plus (`CREDENTIALS_KEY` changée) */
    illisible: boolean
  }
  webhook: {
    provenance: Provenance
    genereLe: Date | null
    illisible: boolean
  }
}

const AUCUNE: ConfigurationDocumenso = {
  provenance: 'aucune',
  baseUrl: '',
  apiKey: '',
}

/**
 * L'instance et la clé en vigueur. Réservé aux appelants qui vont réellement
 * parler à Documenso — jamais rendu tel quel à une page.
 *
 * Une ligne d'écran dont la clé est devenue illisible (clé de chiffrement
 * changée) ne vaut pas configuration : on retombe sur l'environnement, et
 * `readInstanceSecret` a laissé sa ligne de journal — sans quoi rien ne
 * séparerait les deux cas.
 */
export async function lireConfigurationDocumenso(): Promise<ConfigurationDocumenso> {
  const vue = await getInstanceCredential(PROVIDER_DOCUMENSO)
  if (vue !== null && vue.baseUrl !== '') {
    const apiKey = await readInstanceSecret(PROVIDER_DOCUMENSO)
    if (apiKey !== null && apiKey !== '') {
      // La clé ne vit plus dans l'environnement : la liste des variables
      // secrètes du journal ne la couvre plus. On la confie au moment où on la
      // lit, comme le secret du client Google.
      confierSecret(apiKey)
      return { provenance: 'ecran', baseUrl: vue.baseUrl, apiKey }
    }
  }

  const baseUrl = process.env.DOCUMENSO_URL ?? ''
  const apiKey = process.env.DOCUMENSO_API_KEY ?? ''
  if (baseUrl === '' || apiKey === '') return { ...AUCUNE }
  return { provenance: 'env', baseUrl, apiKey }
}

/**
 * L'origine de l'instance en vigueur, pour le `frame-src` de la page client ;
 * `''` sans instance ou sur une URL illisible — la page n'autorise alors aucun
 * cadre, ce qui est le bon défaut.
 */
export async function origineDocumensoEnVigueur(): Promise<string> {
  const { baseUrl } = await lireConfigurationDocumenso()
  if (baseUrl === '') return ''
  try {
    return new URL(baseUrl).origin
  } catch {
    return ''
  }
}

/**
 * Le secret du webhook en vigueur : celui de l'écran, sinon
 * `SIGNATURE_WEBHOOK_SECRET`, sinon `''` — et un secret vide fait tout refuser
 * au webhook, qui ne s'ouvre pas par défaut.
 */
export async function lireSecretWebhook(): Promise<string> {
  const stocke = await readInstanceSecret(PROVIDER_DOCUMENSO_WEBHOOK)
  if (stocke !== null && stocke !== '') {
    confierSecret(stocke)
    return stocke
  }
  return process.env.SIGNATURE_WEBHOOK_SECRET ?? ''
}

export async function vueReglagesSignature(): Promise<VueReglagesSignature> {
  const [config, ligneConnexion, secret, ligneWebhook] = await Promise.all([
    lireConfigurationDocumenso(),
    getInstanceCredential(PROVIDER_DOCUMENSO),
    readInstanceSecret(PROVIDER_DOCUMENSO_WEBHOOK),
    getInstanceCredential(PROVIDER_DOCUMENSO_WEBHOOK),
  ])

  const secretEcran = secret !== null && secret !== ''
  // Une ligne sans secret lisible : le repli reste celui de l'environnement,
  // mais l'écran doit dire pourquoi le réglage saisi n'est pas en vigueur.
  const webhookIllisible = ligneWebhook !== null && !secretEcran
  const cleEcran = await readInstanceSecret(PROVIDER_DOCUMENSO)
  const connexionIllisible = ligneConnexion !== null && (cleEcran === null || cleEcran === '')
  const secretEnv = (process.env.SIGNATURE_WEBHOOK_SECRET ?? '') !== ''

  return {
    connexion: {
      provenance: config.provenance,
      baseUrl: config.baseUrl,
      enregistreLe: config.provenance === 'ecran' ? (ligneConnexion?.connectedAt ?? null) : null,
      ligne: ligneConnexion !== null,
      illisible: connexionIllisible,
    },
    webhook: {
      provenance: secretEcran ? 'ecran' : secretEnv ? 'env' : 'aucune',
      genereLe: secretEcran ? (ligneWebhook?.connectedAt ?? null) : null,
      illisible: webhookIllisible,
    },
  }
}

export type ResultatEnregistrement = { ok: true } | { ok: false; erreurs: string[] }

/** L'adresse de l'instance, réduite à ce qui se réaffiche : sans `/` final. */
function normaliserUrl(brut: string): string | null | 'identifiants' {
  const texte = brut.trim()
  if (texte === '') return null
  let url: URL
  try {
    url = new URL(texte)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  // Le journal part vers des URL tierces et l'écran réaffiche l'adresse :
  // des identifiants glissés dedans fuiraient aux deux endroits.
  if (url.username !== '' || url.password !== '') return 'identifiants'
  return texte.replace(/\/+$/, '')
}

/**
 * Enregistre l'instance et sa clé. **Une clé laissée vide conserve celle qui
 * est enregistrée** : corriger une URL ne doit pas obliger à ressaisir une
 * clé que l'écran ne réaffiche jamais.
 *
 * Rien n'est essayé ici : le bouton « Tester » est fait pour ça, et un
 * Documenso momentanément indisponible ne doit pas empêcher d'enregistrer.
 */
export async function enregistrerConnexionDocumenso(args: {
  userId: string
  baseUrl: string
  apiKey: string
}): Promise<ResultatEnregistrement> {
  const erreurs: string[] = []
  const baseUrl = normaliserUrl(args.baseUrl)
  if (baseUrl === 'identifiants') {
    erreurs.push(
      "L'adresse ne doit pas contenir d'identifiants ; la clé d'API se saisit dans son propre champ.",
    )
  } else if (baseUrl === null) {
    erreurs.push("L'adresse de l'instance Documenso doit être une URL complète, en http(s).")
  }

  let apiKey = args.apiKey.trim()
  const remplacee = apiKey !== ''
  if (!remplacee) {
    const existante = await readInstanceSecret(PROVIDER_DOCUMENSO)
    if (existante === null || existante === '') erreurs.push("La clé d'API est requise.")
    else apiKey = existante
  }
  if (erreurs.length > 0 || baseUrl === null || baseUrl === 'identifiants')
    return { ok: false, erreurs }

  await saveInstanceCredential({
    provider: PROVIDER_DOCUMENSO,
    secret: apiKey,
    baseUrl,
  })

  // Ni la clé ni son empreinte : le journal est poussé vers des URL tierces.
  // Le fait qu'elle ait changé, lui, est une information.
  await consigner(args.userId, {
    cles: remplacee ? ['documensoUrl', 'documensoCle'] : ['documensoUrl'],
    documensoUrl: baseUrl,
  })
  return { ok: true }
}

/** Retire l'instance réglée à l'écran ; l'environnement, s'il existe, reprend la main. */
export async function retirerConnexionDocumenso(args: { userId: string }): Promise<void> {
  await revokeInstanceCredential(PROVIDER_DOCUMENSO)
  await consigner(args.userId, {
    cles: ['documensoUrl', 'documensoCle'],
    documensoUrl: '',
  })
}

/**
 * Génère le secret du webhook — 32 octets aléatoires, en hexadécimal — le
 * scelle, et le rend **une seule fois**, pour qu'il soit collé dans Documenso.
 * Il ne se relit plus jamais à l'écran : le perdre, c'est le régénérer.
 */
export async function genererSecretWebhook(args: { userId: string }): Promise<string> {
  const secret = randomBytes(32).toString('hex')
  await saveInstanceCredential({
    provider: PROVIDER_DOCUMENSO_WEBHOOK,
    secret,
  })
  confierSecret(secret)
  await consigner(args.userId, { cles: ['secretWebhook'] })
  return secret
}

/**
 * Le bouton « Tester », sur la configuration **en vigueur** — celle que le
 * circuit utilisera réellement, écran ou environnement.
 */
export async function testerConfigurationSignature(
  deps: {
    fetchFn?: SignatureFetchLike
    smtpConfigure?: () => Promise<boolean>
  } = {},
): Promise<ResultatVerification> {
  const config = await lireConfigurationDocumenso()
  if (config.provenance === 'aucune') {
    return {
      ok: false,
      verifications: [
        {
          cle: 'configuration',
          etat: 'echec',
          texte: "Aucune configuration : renseignez l'URL de l'instance et la clé d'API.",
        },
      ],
    }
  }

  const fetchFn: SignatureFetchLike =
    deps.fetchFn ?? ((url, init) => fetch(url, { ...(init as RequestInit), redirect: 'manual' }))
  const smtpConfigure = deps.smtpConfigure ?? (async () => (await readSmtpConfig()) !== null)

  return verifierDocumenso({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    fetchFn,
    smtpConfigure: await smtpConfigure(),
  })
}

async function consigner(userId: string, payload: Record<string, unknown>): Promise<void> {
  await appendAudit({
    ...(await actorOf(userId)),
    action: 'reglage.modifie',
    entityType: 'Settings',
    entityId: 'signature',
    payload,
  })
}
