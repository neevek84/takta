import { estCleSensible, redige } from '@/core/log/redact'

/**
 * Journal d'exploitation — le minimum pour qu'une panne se distingue d'un
 * fonctionnement normal.
 *
 * Ce n'est PAS un journal de preuve : rien n'est daté par nos soins (le
 * collecteur d'`docker compose logs` horodate déjà chaque ligne), rien n'est
 * conservé, rien n'est corrélé. La question à laquelle ce journal répond est
 * la seule qui manquait : « pourquoi la connexion Google ne prend-elle pas ? »,
 * là où le chemin Google et la synchronisation étaient entièrement muets —
 * une panne y était indiscernable d'un fonctionnement normal.
 *
 * Une ligne, un événement, un préfixe fixe pour le `grep`. Aucune pile :
 * elles sont illisibles en production et charrient des chemins de fichiers
 * sans rien ajouter au diagnostic d'une variable d'environnement absente.
 */

export type ValeurContexte = string | number | boolean | null | undefined
export type Contexte = Record<string, ValeurContexte>

const PREFIXE = '[cra]'

/**
 * Variables dont la valeur ne doit jamais apparaître, même recopiée par une
 * bibliothèque tierce dans un message d'erreur. Effacées par égalité exacte,
 * ce qui en fait la seule garantie stricte du rédacteur.
 */
export const VARIABLES_SECRETES = [
  'CREDENTIALS_KEY',
  'AUTH_SECRET',
  'SYNC_FLUSH_TOKEN',
  'DATABASE_URL',
  // Ajoutés après coup, et la raison mérite d'être écrite : le journal est
  // devenu bavard — un événement par saisie poussée — et il part désormais
  // vers des URL tierces par les webhooks sortants. Un message d'erreur
  // recopiant l'un de ces quatre secrets l'aurait emporté chez le
  // destinataire. Toute variable de `.env.example` qui nomme un secret doit
  // figurer ici ; un test le vérifie.
  'SIGNATURE_WEBHOOK_SECRET',
  'DOCUMENSO_API_KEY',
  'CRA_API_TOKEN',
  'SMTP_PASSWORD',
] as const

// Le client OAuth Google n'y figure plus : il ne vit plus dans l'environnement
// mais chiffré en base, et cette liste-ci ne lit que l'environnement. Le faire
// lire la base rendrait ce module asynchrone et dépendant de Prisma, alors
// qu'il est appelé depuis le connecteur lui-même.
//
// La garantie ne disparaît pas pour autant, elle change de famille : un secret
// de client est effacé par le nom qui le porte (`client_secret=…`) et, nu, par
// sa forme de chaîne opaque — les deux autres familles de `redact.ts`, toutes
// deux exercées. Et il ne sort de toute façon jamais des deux seules fonctions
// qui le manipulent : l'action d'administration l'expurge elle-même de tout
// message d'erreur avant de le rendre.

/**
 * Lues à chaque appel : un test qui change l'environnement doit être suivi.
 *
 * Exportée pour le journal de preuve (`services/audit.ts`), qui rédige les
 * charges utiles qu'il consigne. Une seconde liste de variables sensibles
 * vivrait ailleurs et prendrait du retard sur celle-ci au premier secret
 * ajouté — et un secret oublié d'une seule des deux listes est un secret
 * publié.
 */
export function secretsDuProcessus(): string[] {
  return [...VARIABLES_SECRETES.map((nom) => process.env[nom] ?? ''), ...secretsConfies].filter(
    (v) => v !== '',
  )
}

/**
 * Secrets que le processus connaît sans qu'ils vivent dans l'environnement.
 *
 * Depuis que les identifiants du client OAuth se saisissent à l'écran et
 * vivent chiffrés en base, la liste des variables ne les couvre plus — et
 * **rien d'autre ne les couvrait** : un secret Google recopié dans un message
 * de refus n'a ni la forme d'une paire nommée, ni forcément celle d'une chaîne
 * opaque, qui exige des chiffres. Il serait sorti en clair.
 *
 * Le service qui vient de lire un secret le confie donc ici, pour la durée du
 * processus. Faire lire la base à ce module le rendrait asynchrone et
 * dépendant de Prisma, alors qu'il est appelé depuis les connecteurs
 * eux-mêmes.
 */
const secretsConfies = new Set<string>()

/** Longueur en deçà de laquelle une valeur confiée découperait les messages. */
const LONGUEUR_MINIMALE_CONFIE = 8

export function confierSecret(valeur: string | null | undefined): void {
  if (typeof valeur !== 'string') return
  if (valeur.length < LONGUEUR_MINIMALE_CONFIE) return
  secretsConfies.add(valeur)
}

/** Uniquement pour les tests : rend le registre à son état initial. */
export function oublierSecretsConfies(): void {
  secretsConfies.clear()
}

/** Un journal reste sur une ligne : sinon il devient illisible au `grep`. */
function surUneLigne(texte: string): string {
  return texte.replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

function paires(contexte: Contexte, secrets: string[]): string {
  const out: string[] = []
  for (const [cle, valeur] of Object.entries(contexte)) {
    if (valeur === undefined) continue
    const brut = estCleSensible(cle) ? '[secret]' : redige(surUneLigne(String(valeur)), secrets)
    out.push(`${cle}=${brut}`)
  }
  return out.join(' ')
}

function ecrit(
  niveau: 'error' | 'warn' | 'info',
  evenement: string,
  contexte: Contexte,
  suffixe = '',
): void {
  const secrets = secretsDuProcessus()
  const corps = [paires(contexte, secrets), suffixe].filter((p) => p !== '').join(' ')
  const ligne = `${PREFIXE} ${niveau} ${evenement} ${corps}`.trimEnd()

  if (niveau === 'error') console.error(ligne)
  else if (niveau === 'warn') console.warn(ligne)
  else console.info(ligne)
}

/**
 * Panne : quelque chose qui devait aboutir n'a pas abouti. Le message de
 * l'exception est conservé — rédigé — parce que c'est lui qui nomme la cause
 * (`CREDENTIALS_KEY est absente`, `Google a refusé la demande de jeton`).
 */
export function journalErreur(evenement: string, err: unknown, contexte: Contexte = {}): void {
  const secrets = secretsDuProcessus()
  const nom = err instanceof Error ? err.name : typeof err
  const message = err instanceof Error ? err.message : String(err)

  ecrit('error', evenement, contexte, `erreur=${nom} message="${redige(surUneLigne(message), secrets)}"`)
}

/** État dégradé mais traité : la conduite à tenir existe, elle est connue. */
export function journalAvertissement(evenement: string, contexte: Contexte = {}): void {
  ecrit('warn', evenement, contexte)
}

/** Fait d'exploitation notable, sans anomalie. */
export function journalInfo(evenement: string, contexte: Contexte = {}): void {
  ecrit('info', evenement, contexte)
}
