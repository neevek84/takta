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
const VARIABLES_SECRETES = [
  'CREDENTIALS_KEY',
  'AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'SYNC_FLUSH_TOKEN',
  'DATABASE_URL',
] as const

/** Lues à chaque appel : un test qui change l'environnement doit être suivi. */
function secretsDuProcessus(): string[] {
  return VARIABLES_SECRETES.map((nom) => process.env[nom] ?? '').filter((v) => v !== '')
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
