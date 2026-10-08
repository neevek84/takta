/**
 * Les règles du réglage SMTP, sans base ni réseau : les préréglages, la
 * validation de ce que l'écran envoie, et la traduction des erreurs du
 * transport en phrases qu'un administrateur peut suivre.
 *
 * Isolé dans `core/` pour que l'écran (préréglages) et le service (validation,
 * test d'envoi) parlent exactement des mêmes valeurs.
 */

/**
 * Délais du transport, en millisecondes : connexion, accueil du serveur, et
 * silence sur la socket. Au-delà, l'envoi échoue en « injoignable » au lieu de
 * laisser une action serveur pendre jusqu'à ce que le proxy coupe — ce qui fait
 * tomber la page entière.
 */
export const DELAIS_SMTP = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  // Plus large : un PDF signé en pièce jointe peut attendre l'analyse du
  // contenu par le serveur après DATA.
  socketTimeout: 30_000,
} as const

/** Plafond du test d'envoi, au-dessus du plus long délai du transport. */
export const DELAI_TEST_SMTP_MS = 45_000

export type CleChiffrement = 'tls' | 'starttls'

export type ClePreset = 'google-app' | 'google-relais' | 'microsoft' | 'autre'

export interface PresetSmtp {
  libelle: string
  host: string
  port: number
  secure: boolean
  /** l'identifiant de connexion est l'adresse d'expédition elle-même */
  utilisateurEgalExpediteur: boolean
  /** le serveur n'attend ni utilisateur ni mot de passe */
  sansAuthentification: boolean
  /** ce qu'il faut savoir avant de cliquer « Enregistrer », phrase par phrase */
  aide: string[]
}

export const PRESETS_SMTP: Record<ClePreset, PresetSmtp> = {
  'google-app': {
    libelle: "Google Workspace — mot de passe d'application",
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    utilisateurEgalExpediteur: true,
    sansAuthentification: false,
    aide: [
      "L'utilisateur est l'adresse d'expédition elle-même.",
      'La validation en deux étapes doit être active sur ce compte.',
      "Créez le mot de passe dans Compte Google → Sécurité → Mots de passe d'application, et collez-le ici.",
      'Google refuse le mot de passe ordinaire du compte depuis mars 2025.',
    ],
  },
  'google-relais': {
    libelle: 'Google Workspace — relais SMTP',
    host: 'smtp-relay.gmail.com',
    port: 587,
    secure: false,
    utilisateurEgalExpediteur: false,
    sansAuthentification: true,
    aide: [
      "Ni utilisateur ni mot de passe : c'est l'adresse IP qui est autorisée.",
      "Déclarez le relais dans la console d'administration Workspace (Applications → Gmail → Routage → Service de relais SMTP), en autorisant l'adresse IP publique du NAS.",
      "L'adresse d'expédition doit appartenir au domaine Workspace.",
    ],
  },
  microsoft: {
    libelle: 'Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    utilisateurEgalExpediteur: true,
    sansAuthentification: false,
    aide: [
      "L'envoi SMTP authentifié doit être autorisé pour cette boîte dans le centre d'administration Microsoft 365.",
    ],
  },
  autre: {
    libelle: 'Autre serveur',
    host: '',
    port: 0,
    secure: true,
    utilisateurEgalExpediteur: false,
    sansAuthentification: false,
    aide: [
      'Port 465 : chiffrement TLS direct. Port 587 : STARTTLS. Laissez l’utilisateur vide pour un relais sans authentification.',
    ],
  },
}

export const CLES_PRESET: readonly ClePreset[] = [
  'google-app',
  'google-relais',
  'microsoft',
  'autre',
]

/** Le préréglage qui correspond à un serveur enregistré, pour réafficher la bonne aide. */
export function presetPourServeur(host: string, port: number): ClePreset {
  const h = host.trim().toLowerCase()
  for (const cle of CLES_PRESET) {
    const p = PRESETS_SMTP[cle]
    if (cle !== 'autre' && p.host === h && p.port === port) return cle
  }
  return 'autre'
}

const ADRESSE = /^[^\s<>@",;]+@[^\s<>@",;]+\.[^\s<>@",;]+$/

/**
 * L'adresse d'une valeur d'expéditeur — nue, ou `Nom <adresse>` comme
 * nodemailer l'accepte — ou `null`. Un seul expéditeur, et aucun saut de
 * ligne : une valeur qui finit dans un en-tête ne doit pas pouvoir en ajouter.
 */
export function adresseExpediteur(brut: string): string | null {
  if (/[\r\n]/.test(brut)) return null
  const texte = brut.trim()
  if (ADRESSE.test(texte)) return texte
  const m = /^(?:"[^"<>]*"|[^"<>,;]*)\s*<([^<>]+)>$/.exec(texte)
  if (m === null) return null
  const adresse = m[1]!.trim()
  return ADRESSE.test(adresse) ? adresse : null
}

/** Une adresse de destinataire simple : le test d'envoi n'en prend qu'une. */
export function estAdresse(brut: string): boolean {
  return ADRESSE.test(brut.trim())
}

export interface ReglagesSmtpSaisis {
  host: string
  port: string
  chiffrement: string
  user: string
  from: string
}

export interface ReglagesSmtp {
  host: string
  port: number
  secure: boolean
  user: string
  from: string
}

export type ResultatValidationSmtp =
  | { ok: true; valeur: ReglagesSmtp }
  | { ok: false; erreurs: string[] }

const NOM_HOTE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/

/** Valide la saisie de l'écran ; le serveur est la seule barrière qui compte. */
export function validerReglagesSmtp(saisie: ReglagesSmtpSaisis): ResultatValidationSmtp {
  const erreurs: string[] = []

  const host = saisie.host.trim()
  if (host === '') erreurs.push('Le serveur SMTP est requis.')
  else if (!NOM_HOTE.test(host) || host.length > 253)
    erreurs.push('Le serveur doit être un nom d’hôte seul, sans « smtp:// » ni port (ex. smtp.gmail.com).')

  const portTexte = saisie.port.trim()
  const port = /^\d{1,5}$/.test(portTexte) ? Number(portTexte) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    erreurs.push('Le port doit être un nombre entre 1 et 65535 (465 ou 587 le plus souvent).')

  let secure = true
  if (saisie.chiffrement === 'tls') secure = true
  else if (saisie.chiffrement === 'starttls') secure = false
  else erreurs.push('Choisissez le chiffrement : TLS direct (465) ou STARTTLS (587).')

  const user = saisie.user.trim()
  if (/[\s\u0000-\u001f]/.test(user))
    erreurs.push("L'utilisateur ne doit contenir ni espace ni saut de ligne.")

  const from = saisie.from.trim()
  if (from === '') erreurs.push("L'adresse d'expédition est requise.")
  else if (adresseExpediteur(from) === null)
    erreurs.push(
      "L'adresse d'expédition doit être une adresse valide, éventuellement précédée d'un nom : Kreativ <noreply@exemple.fr>.",
    )

  if (erreurs.length > 0) return { ok: false, erreurs }
  return { ok: true, valeur: { host, port, secure, user, from } }
}

/** Codes d'erreur de certificat ou de négociation TLS (Node et OpenSSL). */
const CODES_TLS = new Set([
  'ETLS',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_SSL_WRONG_VERSION_NUMBER',
])

const CODES_RESEAU = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ENOTFOUND'])

/**
 * Une erreur du transport, en français et **sans le message du serveur** : il
 * peut recopier l'identifiant, voire le secret refusé. Seul le code, une
 * courte chaîne en capitales, se cite — et seulement s'il en a la forme.
 *
 * Le message est lu pour **classer** (un « wrong version number » arrive sous
 * `ESOCKET`), jamais pour être affiché.
 */
export function messageErreurSmtp(err: unknown): string {
  const brutCode = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined
  const code = typeof brutCode === 'string' && /^[A-Z][A-Z0-9_]{1,40}$/.test(brutCode) ? brutCode : ''
  const message = err instanceof Error ? err.message : ''
  const suffixe = code === '' ? '' : ` (code ${code})`

  if (/starttls/i.test(message)) {
    return (
      "Le serveur n'offre pas STARTTLS, que ce réglage exige : l'authentification ne partirait pas " +
      `chiffrée. Vérifiez le port (587 : STARTTLS, 465 : TLS direct) et le serveur${suffixe}.`
    )
  }
  if (
    CODES_TLS.has(code) ||
    /certificate|wrong version number|ssl routines|\btls\b/i.test(message)
  ) {
    return (
      'La négociation chiffrée a échoué : le chiffrement est sans doute inadapté au port ' +
      `(465 : TLS direct, 587 : STARTTLS), ou le certificat du serveur n'est pas valide${suffixe}.`
    )
  }
  if (code === 'EAUTH') {
    return (
      'Le serveur a refusé les identifiants. Pour Google, utilisez un mot de passe ' +
      `d'application (le mot de passe du compte est refusé) ou le relais SMTP${suffixe}.`
    )
  }
  if (CODES_RESEAU.has(code)) {
    return (
      'Le serveur est injoignable ou le port est bloqué : vérifiez le nom du serveur, le port, ' +
      `et que le chiffrement correspond au port (465 : TLS direct, 587 : STARTTLS)${suffixe}.`
    )
  }
  if (code === 'EENVELOPE') {
    return (
      "Le serveur a refusé l'expéditeur ou le destinataire. Pour le relais Google, l'adresse " +
      `d'expédition doit appartenir au domaine et l'adresse IP du NAS être autorisée${suffixe}.`
    )
  }
  return `L'envoi a échoué${suffixe}. Vérifiez les réglages, puis réessayez.`
}
