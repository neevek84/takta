/**
 * Rédaction des secrets avant journalisation. Pur, sans dépendance : c'est la
 * dernière barrière entre un message d'erreur et la sortie standard du
 * serveur, et elle doit pouvoir être exercée en isolation.
 *
 * Le principe est celui du filet, pas celui de la confiance : on ne suppose
 * jamais qu'un message d'erreur est propre. Trois familles sont couvertes, du
 * plus sûr au plus heuristique :
 *
 *   1. les valeurs de secret **connues** du processus, effacées par égalité
 *      exacte — c'est la seule garantie stricte, et elle couvre nos propres
 *      variables (`CREDENTIALS_KEY`, `AUTH_SECRET`, `GOOGLE_CLIENT_SECRET`…) ;
 *   2. les paires **nommées** (`client_secret=…`, `"access_token": "…"`,
 *      `Bearer …`), où le nom trahit la valeur ;
 *   3. les longues chaînes opaques non nommées, reconnues à leur forme.
 *
 * Le nom, lui, est toujours conservé : « CREDENTIALS_KEY est absente » doit
 * rester lisible, c'est exactement l'information qui rend une panne
 * diagnosticable.
 */

const JETON_REDIGE = '[secret]'

/**
 * En dessous de cette longueur, une « valeur de secret » effacerait des mots
 * ordinaires (`true`, `3`, `GET`) et découperait tous les messages.
 */
const LONGUEUR_MINIMALE_SECRET = 8

/**
 * Noms qui désignent une valeur à ne jamais écrire. `client_id` en fait
 * partie : ce n'est pas un secret au sens strict, mais il identifie
 * l'installation OAuth et n'a rien à faire dans un journal.
 */
const NOM_SENSIBLE =
  /(token|secret|password|passwd|credential|authorization|auth|apikey|api[_-]key|_key|key$|^key|client[_-]?id|refresh|access|bearer|cookie|session|signature|^code$|_code$)/i

/** Vrai quand une clé de contexte ne doit jamais voir sa valeur journalisée. */
export function estCleSensible(nom: string): boolean {
  return NOM_SENSIBLE.test(nom)
}

/**
 * Paires `clé=valeur`, `clé: valeur` et `"clé": "valeur"`, avec un éventuel
 * préfixe `Bearer` conservé : c'est lui qui dit de quoi il s'agit.
 */
const PAIRE_NOMMEE =
  /(["']?)([A-Za-z_][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)(Bearer\s+)?(?:"([^"]*)"|'([^']*)'|([^\s,;&)}\]"']+))/g

/** Jeton porté sans nom de champ (`Authorization: Bearer …` déjà découpé). */
const BEARER_NU = /\bBearer\s+([^\s,;"']+)/g

/**
 * Chaîne opaque : au moins 24 caractères de l'alphabet des jetons, mêlant
 * majuscules et chiffres. La barre est haute volontairement — un chemin d'URL
 * ou un `cuid()` Prisma (minuscules) doivent survivre, ce sont eux qui
 * permettent de retrouver la ligne concernée. `/` est exclu de l'alphabet pour
 * la même raison : sans quoi `…/calendar/v3/calendars/…` partirait avec.
 */
const CHAINE_OPAQUE = /[A-Za-z0-9+_-]{24,}={0,2}/g

/**
 * Rend `texte` publiable dans un journal.
 *
 * `secrets` porte les valeurs connues du processus appelant. Elles sont
 * effacées par recherche littérale — jamais par expression régulière : une clé
 * base64 contient `+`, `/` et `=`, qui sont des métacaractères.
 */
export function redige(texte: string, secrets: readonly string[] = []): string {
  if (texte === '') return ''

  let sortie = texte

  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length < LONGUEUR_MINIMALE_SECRET) continue
    sortie = sortie.split(secret).join(JETON_REDIGE)
  }

  sortie = sortie.replace(
    PAIRE_NOMMEE,
    (tout, guillemet, cle, separateur, bearer, entreDoubles, entreSimples, nu) => {
      if (!estCleSensible(cle as string)) return tout as string
      const prefixe = `${guillemet}${cle}${guillemet}${separateur}${bearer ?? ''}`
      if (entreDoubles !== undefined) return `${prefixe}"${JETON_REDIGE}"`
      if (entreSimples !== undefined) return `${prefixe}'${JETON_REDIGE}'`
      if (nu === JETON_REDIGE) return tout as string
      return `${prefixe}${JETON_REDIGE}`
    },
  )

  sortie = sortie.replace(BEARER_NU, (tout, valeur) =>
    valeur === JETON_REDIGE ? (tout as string) : `Bearer ${JETON_REDIGE}`,
  )

  return sortie.replace(CHAINE_OPAQUE, (bloc) =>
    /[A-Z]/.test(bloc) && /[0-9]/.test(bloc) ? JETON_REDIGE : bloc,
  )
}
